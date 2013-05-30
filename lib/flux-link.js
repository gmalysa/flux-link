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
var env = require('./environment');
var helpers = require('./helpers');
var Environment = env.Environment;
var LocalEnvironment = env.LocalEnvironment;

var slice = Array.prototype.slice;
var nextTick = process.nextTick;

if (process.version.match(/\.(11|10)\./))
	nextTick = setImmediate;

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
		this.fns = fns.map(this.wrap);
	else
		this.fns = slice.call(arguments).map(this.wrap);

	var that = this;
	this.bind_after_env = false;
	this.name = '(anonymous chain)';

	// To simplify making the length (which indicates argument count) reflect what the first function needs
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
	 * The exception handling wrapper that is pushed to the stack. Previously this was defined inside
	 * apply(), but it doesn't need to be a closure, so it is better to define it externally and pass
	 * it in. This function ensures that context information unwinds properly in the event of exceptions
	 * being thrown, and it will also invoke handlers if they were defined.
	 * @param env The environment variable
	 * @param varargs will be forwarded to the inner exception handler
	 */
	exception_handler : function(env) {
		// This already includes env, so don't re-include it when forwarding arguments
		var params = slice.call(arguments);

		if (this.exception) {
			env._fm.$push_call(helpers.fname(this.exception));
			env._fm.$pop_ctx();
			this.exception.apply(null, params);
		}
		else {
			env._fm.$pop_ctx();
			env.$throw(params);
		}
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

		// Each chain adds an exception handler to update context information, it'll call the user handler
		env._fm.$push_exception_handler(this.exception_handler.bind(this), after);

		// Set up our context-wrapping after and then create the serial chain
		after = this.make_after_glue(env, after);
		var cb = this.make_serial_chain(this.fns, env, after);

		// Invoke chain, passing forward arguments received
		env._fm.$push_ctx(this.name);
		cb.apply(null, args.slice(2));
	},

	/**
	 * Helper function to wrap the after() callback given with one that will update our tracking,
	 * update the exception stack, and then eventually forward control properly
	 * @param env The environment to use for after
	 * @param after The after paramer that is to be wrapped appropriately
	 * @return New after method with state updates
	 */
	make_after_glue : function(env, after) {
		var that = this;
		var after_name = helpers.fname(after, '(lambda function)');

		return function __after_glue() {
			var params = slice.call(arguments);

			if (that.bind_after_env)
				params.unshift(env);

			if (!helpers.hide_function(after_name))
				env._fm.$push_call(after_name);

			env._fm.$pop_ctx();
			env._fm.$pop_exception_handler();
			after.apply(null, params);
		};
	},

	/**
	 * Helper that builds a serial callback chain out of an array of functions, including a given
	 * environment and after pointer
	 * @param fns Array of functions to convert into a serial chain
	 * @param env The environment to bind to the chain
	 * @param after The function to call after the chain terminates
	 * @return Callback that should be invoked to begin the serial chain
	 */
	make_serial_chain : function(fns, env, after) {
		var that = this;
		return fns.reduceRight(function(memo, v) {
			return function __chain_inner() {
				// Create parameters array for the function we're calling
				var params = that.handle_args(env, v, slice.call(arguments));
				params.unshift(env, memo);

				// Once 10.x is "common enough"--perhaps around the time of 0.12.0 or so, remove this
				// closure, force the use of setImmediate, and pass in env, params, and v as arguments
				// to avoid generating anonymous functions for each callback in the chain
				nextTick(function() {
					// Catch exceptions inside the application and pass them to env.$throw instead
					try {
						env._fm.$push_call(helpers.fname(v, v.fn.name));
						v.fn.apply(v.ctx, params);
					}
					catch (err) {
						env.$throw(err);
					}
				});
			};
		}, after);
	},

	/**
	 * Helper function that is used to process the arguments and produce an array of proper arguments
	 * to be passed to fn.apply()
	 * @param env The environment object where the stack might be used
	 * @param info Function information (result of mkfn, normally)
	 * @param args The arguments array passed to the outer function
	 * @return Array arguments that should be passed to the actual function being called
	 */
	handle_args : function(env, info, args) {
		var missing = info.params - args.length;

		// Get missing args from the stack
		if (missing == 0)
			return args;
		else if (missing > 0)
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
		this.apply(ctx, [env, after].concat(slice.call(arguments, 3)));
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

/**
 * A Loop Chain will iterate over its functions until the condition function specified returns
 * false, standardizing and simplifying the implementation for something that could already be
 * done with standard serial Chains.
 * @param cond Conditional function that is evaluated with an environment and an after
 * @param fns/varargs Functions to use for the body of the chain
 */
function LoopChain(cond, fns) {
	if (_.isArray(fns))
		Chain.apply(this, fns);
	else
		Chain.apply(this, slice.call(arguments, 1));
	
	this.cond = cond;
	this.name = '(anonymous loop chain)';
}
LoopChain.prototype = new Chain();
LoopChain.prototype.constructor = LoopChain;
_.extend(LoopChain.prototype, {
	/**
	 * Allow people to set the condition function later, because why not?
	 * @param cond Callback to be used as the condition function
	 */
	set_cond : function(cond) {
		this.cond = cond;
	},

	/**
	 * Really, the only thing that needs to change is that we modify the apply() method, so that it tests
	 * the condition before executing the loop and after. Arguments are not forwarded, so do not supply
	 * any extra arguments.
	 * @param ctx required for apply() compatibility, ignored
	 * @param args The rest of the arguments. The first two parameters should be env and after as usual
	 */
	apply : function(ctx, args) {
		var env = args[0];
		var after = args[1] || _.identity;
		var that = this;
		var check, cb;
	
		// Push exception handler wrapper with bare after call
		env._fm.$push_exception_handler(this.exception_handler.bind(this), after);
	
		// Update after to remove our context when there is no exception
		after = this.make_after_glue(env, after);
	
		// Check if the loop condition is true with some nested closures to provide uniform continuation
		// passing implementation.
		check = function() {
			env._fm.$push_call(helpers.fname(that.cond, '(lambda condition)'));
			that.cond.call(null, env, function(result) {
				if (result)
					cb.apply(null, []);
				else
					nextTick(after);
			});
		};

		// Build loop body
		cb = this.make_serial_chain(this.fns, env, check);

		// The structure is while(cond) { body(); }, so start with a condition check
		env._fm.$push_ctx(this.name);
		check();
	}
});

/**
 * A parallel chain, which invokes all of the functions/chains/etc. underneath it at the same time
 * and then waits for them to all complete, before passing control to after. It also passes a local
 * environment to each parallel chain, so that they have thread-local storage. It includes a pointer
 * to the globally shared environment.
 * @param fns Array of functions to use. Alternatively, varargs, each argument is a function
 */
function ParallelChain(fns) {
	if (_.isArray(fns))
		Chain.apply(this, fns);
	else
		Chain.apply(this, slice.call(arguments));

	this.name = '(anonymouse parallel chain)';

	// Remove getter and replace with length zero because this cannot accept arguments
	delete this.length;
	this.length = 0;
}
ParallelChain.prototype = new Chain();
ParallelChain.prototype.constructor = ParallelChain;
_.extend(ParallelChain.prototype, {
	/**
	 * As usual, most of the rewriting happens in apply.
	 * @param ctx The this context, ignored
	 * @param args Array of arguments. 0 must be env, 1 must be after
	 */
	apply : function(ctx, args) {
		var env = args[0];
		var after = args[1] || _.identity;

		// Lots of variables that we need to use in generating closures
		var exception_happened = false;
		var exception = null;
		var that = this;
		var expected = this.fns.length;

		// Push exception handler, same as always, which we'll call if any thread encounters a problem
		env._fm.$push_exception_handler(this.exception_handler.bind(this), after);
		
		// Count the environments that terminate until there are none outstanding before forwarding
		after = this.make_after_glue(after);
		var parallel_terminator = function() {
			expected -= 1;
			if (expected == 0) {
				if (exception_happened)
					env.$throw(exception);
				else
					nextTick(after);
			}
		};

		// Inner exception handler used for each parallel thread. Declared once here to reduce overhead
		var inner_handler = function __inner_handler(env, err) {
			exception_happened = true;
			exception = err;
			env.$catch();
		};

		// Push backtracing context
		env._fm.$push_ctx(this.name);

		// Iterate over functions, create local environment, and spawn them all
		this.fns.forEach(function(v, k) {
			var lenv = new LocalEnvironment(env, k);

			// Lots of state to push locally as well, before we can call
			lenv._fm.$push_ctx(that.name);
			lenv._fm.$push_call(helpers.fname(v, f.fn.name));
			lenv._fm.$push_exception_handler(inner_handler, parallel_terminator);

			// Push off the function call until next tick, just to enforce async behavior
			nextTick(function() {
				try {
					v.fn.call(v.ctx, lenv, parallel_terminator);
				}
				catch (e) {
					lenv.$throw(e);
				}
			});
		});
	}
});

// Export library interface-type functions
module.exports.Chain = Chain;
module.exports.LoopChain = LoopChain;
module.exports.Environment = Environment;
module.exports.mkfn = mkfn;