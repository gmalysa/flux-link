/**
 * Library for chaining together functions to implement some control flow functionality that
 * helps alleviate the issues of callback nesting, by generating glue between functions that
 * represent "basic block"-like portions of program code. Each chain has both array-like and
 * function-like behavior, allowing it to be invoked with apply(), or manipulated prior to
 * invocation with array functions. Chains can be used multiple times with different
 * environment objects, allowing them to be created once and then reused.
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use granted under the terms of the MIT License. See LICENSE for details.
 */

var _ = require('underscore');
var Environment = require('./environment');
var helpers = require('./helpers');

/**
 * Makes a function specification that is useful to pass to the Chain constructor by saving
 * how many arguments are retrieved from the stack to invoke the function.
 * @param fn Function object to call
 * @param params Integer count of parameters
 * @param name Name to give the function in call/back traces (defaults to fn.name if omitted)
 * @param ctx (Javscript) context in which to call the function, null if not necessary
 */
function mkfn(fn, params, name, ctx) {
	return {
		fn : fn,
		ctx : ctx || null,
		params : params || 0,
		name : name || null,
	};
}

/**
 * Creates an object that represents a series of functions that will be called sequentially
 * These functions must have "prototype" information given through mkfn. This is because fn.length
 * is not a reliable way to get the number of arguments. For instance, if _.partial() or _.bind()
 * are used to save a context, fn.length will produce zero, even though there are additional required
 * arguments for the wrapped function. That said, if someone passes a function instead of the result
 * from mkfn(), we will try to wrap it as best we can, and so we have to trust Function.length
 * @param fns Array of functions to form the chain, with definitions given by mkfn()
 * @param ... Or, a bunch of functions not as an array, will convert them appropriately
 */
function Chain(fns) {
	if (_.isArray(fns))
		this.fns = _.map(fns, this.wrap);
	else
		this.fns = _.map(Array.prototype.slice.call(arguments), this.wrap);

	var that = this;
	this.bind_after_env = false;
	this.name = '(anonymous chain)';

	// In newer versions of nodejs:
	//this.defineProperty(this, 'length', {get : function() { return this.fns[0].params; }});
	this.__defineGetter__('length', function() {
		if (that.fns[0])
			return that.fns[0].params;
		return 0;
	});
}

// Class methods for the Chain objects
_.extend(Chain.prototype, {
	/**
	 * Wraps a bare function, or another Chain, if given, in a mkfn() call. Otherwise, assumes
	 * that the object is from mkfn() and returns it unaltered
	 * @param fn Function to check/wrap
	 * @return Wrapped function as produced by mkfn
	 */
	wrap : function(fn) {
		// First two parameters are env and after, so ignore them for normal functions
		// but for chains this has already been taken into account

		if (typeof fn == 'function')
			return mkfn(fn, fn.length-2);
		else if (fn instanceof Chain)
			return mkfn(fn, fn.length);
		return fn;
	},

	/**
	 * Sets a function to act as an exception handler for this Chain. If env.$throw() is invoked, this
	 * handler will be called first, then any after() specified during apply(), and finally, it will
	 * attempt to pass the exception down the exception stack until it is caught
	 * @param fn A plain callback, it must take env as its first argument
	 */
	set_exception_handler : function(fn) {
		this.exception = fn;
	},

	/**
	 * If set to true, this will bind the after handler with env as its first argument, otherwise it
	 * is assumed that the after handler already has a reference to env
	 * @param bind Boolean, should we bind env to the after handler before chaining it?
	 */
	set_bind_after_env : function(bind) {
		this.bind_after_env = bind;
	},

	/**
	 * Implement a function-like interface by providing the apply method to invoke the chain
	 * @param ctx Normally a "context" in which to call this function. Ignored here
	 * @param args The arguments to this chain. The first should be an environment, the second should be
	 *             an optional callback. Anything after that is forwarded on the stack to the first method
	 */
	apply : function(ctx, args) {
		var env = args[0];
		var after = args[1] || _.identity;
		var that = this;
		var after_name = helpers.fname(after, '(lambda function)');

		// If after() is not already bound to env, we need to pass it along
		if (this.bind_after_env) {
			after = _.partial(after, env);
		}

		// Each chain adds an exception handler to update context information, but it won't do anything if
		// no real handler was provided
		env._fm.$push_exception_handler((function() {
			// This already includes env, so don't re-include it when forwarding arguments
			var params = Array.prototype.slice.call(arguments);

			if (this.exception) {
				env._fm.$push_call(helpers.fname(this.exception));
				env._fm.$pop_ctx();
				this.exception.apply(null, params);
			}
			else {
				env._fm.$pop_ctx();
				env.$throw(params);
			}
		}).bind(this), after);

		// Create a wrapper for after to always undo the exception handler and update context info before
		// calling the real handler
		var real_after = after;
		after = function __after_glue() {
			var params = Array.prototype.slice.call(arguments);

			if (!helpers.hide_function(after_name))
				env._fm.$push_call(after_name);

			env._fm.$pop_ctx();
			env._fm.$pop_exception_handler();
			real_after.apply(null, params);
		};

		// Create callback chain
		var cb = _.reduceRight(this.fns, function(memo, v) {
			return function __chain_inner() {
				var params = that.handle_args(env, v, Array.prototype.slice.call(arguments));

				// I thought about making this up to the end user to call in his functions, but in the
				// end I don't think we lose anything by simply always pushing these to the next tick,
				// even if they're fully synchronous functions that were chained together.
				process.nextTick(function() {
					// Catch exceptions inside the application and pass them to env.$throw instead
					try {
						env._fm.$push_call(helpers.fname(v, v.fn.name));
						v.fn.apply(v.ctx, [env, memo].concat(params));
					}
					catch (err) {
						env.$throw(err);
					}
				});
			};
		}, after);

		// Invoke chain, passing forward arguments received
		env._fm.$push_ctx(this.name);
		cb.apply(null, args.splice(2));
	},

	/**
	 * Helper function that is used to process the arguments and produce an array of proper arguments
	 * to be passed to fn.apply()
	 * @param env The environment object where the stack might be used
	 * @param info Function information (result of mkfn, normally)
	 * @param args The arguments array passed to the outer function
	 * @return Array arguments that should be passed to the actual function being called
	 */
	handle_args : function (env, info, args) {
		var missing = info.params - args.length;

		// Get missing args from the stack
		if (missing > 0)
			return env._fm.stack.splice(-missing, missing).concat(args);
		else {
			// Push extra args to the stack, so for instance if passed arg1, arg2, and arg3,
			// but we only consume arg1, the stack will have [arg2, arg3] pushed to it and made
			// available to the next function if it needs additional arguments
			env._fm.stack = env._fm.stack.concat(args.splice(missing, -missing));
			return args;
		}
	},

	/**
	 * Implement the call method, use it to simply forward to apply, to avoid rewriting
	 * the same logic, but call is more convenient in some (many) situations for external
	 * use
	 * @param ctx The context in which to call this chain, which is ignored
	 * @param env The environment object to pass to the chain
	 * @param after The next callback to call after the chain
	 * @param ... varargs that will be forwarded along to the chain
	 */
	call : function(ctx, env, after) {
		this.apply(ctx, [env, after].concat(Array.prototype.slice.call(arguments, 3)));
	},

	/**
	 * Insert a function at an arbitrary point in the chain
	 * @param fn The function to insert, should be produced by mkfn(), but we will wrap it
	 * @param pos The position at which to insert the function
	 */
	insert : function(fn, pos) {
		this.fns.splice(pos, 0, this.wrap(fn));
	},

	/**
	 * Removes the function at a specific position in the chain
	 * @param pos The position of the function to remove
	 */
	remove : function(pos) {
		this.fns.splice(pos, 1);
	},

	/**
	 * Adds a function to the end of this chain.
	 * @param fn The function to push. Should be produced by mkfn(), but we'll wrap it if not
	 */
	push : function(fn) {
		this.fns.push(this.wrap(fn));
	},

	/**
	 * Removes a function from the end of this chain
	 */
	pop : function() {
		this.fns.pop();
	},

	/**
	 * Prepends a function onto this chain
	 * @param fn The function to prepend. Should be produced by mkfn() but we'll wrap it
	 */
	unshift : function(fn) {
		this.fns.unshift(this.wrap(fn));
	},

	/**
	 * Removes a function from the front of the chain
	 */
	shift : function() {
		this.fns.shift();
	}

});

// Export library interface-type functions
module.exports.Chain = Chain;
module.exports.Environment = Environment;
module.exports.mkfn = mkfn;
