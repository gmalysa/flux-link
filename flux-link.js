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

/**
 * Makes a function specification that is useful to pass to the Chain constructor by saving
 * how many arguments are retrieved from the stack to invoke the function.
 * @param fn Function object to call
 * @param params Integer count of parameters
 * @param ctx Context in which to call the function, null if not necessary
 */
function mkfn(fn, params, ctx) {
	return {
		fn : fn,
		ctx : ctx || null,
		params : params || 0
	};
}

/**
 * Creates/extends an object suitable to use as an environment by initializing the stack and some utility
 * methods.
 *
 * Calling convention for passing arguments on the stack: Arguments are pushed in the order they are expected,
 * that is:
 * [---lower stack frames---][ push arg 1 ][ push arg 2 ][ push arg 3 ]
 * When calling the next method, the appropriate number of arguments will be popped off of the end of the stack,
 * so if after only requires two arguments, it will pop off arg 2 and arg 3, leaving arg 1 on the stack. This
 * is useful for passing arguments past function calls or returning multiple values from a function call.
 *
 * @param env Optional base environment with initial local variables
 * @param log Function to use to log critical errors (like when $throw() is called with no exception handlers)
 * @return environment object to be passed to chain.apply
 */
function mkenv(env, log) {
	env = env || {};
	return _.extend(env, {
		_cf : {
			stack : [],
			call_first : null,
			call_current : null,
			call_stack : [],
			abort_stack : [],
			abort_after : null,
			$log : log,
			$push_ctx : _.bind(cf_push_ctx, env),
			$pop_ctx : _.bind(cf_pop_ctx, env),
			$push_call : _.bind(cf_push_call, env)
		},
		$throw : _.bind(cf_throw, env),
		$catch : _.bind(cf_catch, env),
		$check : _.bind(cf_check, env),
		$push : _.bind(cf_push, env),
		$pop : _.bind(cf_pop, env),
		$get_call_trace : _.bind(cf_get_trace, env)
	});
}

/**
 * Pushes a value to the parameter stack. Wraps the 'private' member field _cf, so that user code does
 * not need to be aware of it
 * @param value Any, the value to push to the stack
 */
function cf_push(value) {
	this._cf.stack.push(value);
}

/**
 * Pops a value from the parameter stack. Again, this is to keep user code from needing to touch our
 * internal state
 * @return topmost value from the stack
 */
function cf_pop() {
	return this._cf.stack.pop();
}

/**
 * Pushes a new context onto the call stack, which is done whenever a new chain is entered. Each context
 * tracks the function calls within that chain, but is removed after the chain exists, in order to simplify
 * some of the "depth" if we need to print a backtrace.
 * @param name The name of the chain creating a context
 */
function cf_push_ctx(name) {
	if (this._cf.call_first === null) {
		var ctx = new Context(name);
		this._cf.call_current = ctx;
		this._cf.call_first = ctx;
	}

	var ctx = new ContextHead();

	if (this._cf.call_current !== null) {
		this._cf.call_current.child = ctx;
	}

	this._cf.call_stack.push(this._cf.call_current);
	this._cf.call_current = ctx;
}

/**
 * Pushes a function call into the current call context, which is done whenever a function within a chain
 * is evaluated (regardless of type).
 * @param name The name of the function call
 */
function cf_push_call(name) {
	var ctx = new Context(name);
	this._cf.call_current.next = ctx;
	this._cf.call_current = ctx;
}

/**
 * Pops the topmost context, done just before the after method is executed at the end of a chain
 */
function cf_pop_ctx() {
	this._cf.call_current = this._cf.call_stack.pop();
}

/**
 * Top level trace function that retrieves the trace for this execution from the beginning
 * @return string Complete call trace string
 */
function cf_get_trace() {
	return cf_get_ctx_string(this._cf.call_first, 0);
}

/**
 * Retrieves a string describing the given context/call chain. This uses a depth-first traversal
 * algorithm to print out chains in a logical order. This prints the entire call chain, not just
 * the active portion, which is useful for determining all of the function calls that were made
 * after the topmost chain has completed execution
 * @param ctx The context to use as a root node
 * @param depth The depth level of this context (used for indentation)
 */
function cf_get_ctx_string(ctx, depth) {
	if (ctx === null)
		return '';

	var recurse = cf_get_ctx_string(ctx.child, depth+1) + cf_get_ctx_string(ctx.next, depth);
	
	// Don't print context heads because they just clutter things
	if (ctx instanceof ContextHead)
		return recurse;
	
	return '\n' + (new Array(depth+1)).join('  ') + ctx.name + recurse;
}

/**
 * Function to throw an exception within an environment, calling the topmost handler on the abortion
 * stack. This should be called *on* the env object, as env.$throw(). Optional arguments are allowed,
 * their interpretation is up to the user. They will be passed to the first handler (and only to the
 * first handler, unless it decides to pass them further).
 * @param varargs Forwarded arguments to the first handler
 */
function cf_throw() {
	if (this._cf.abort_stack.length == 0) {
		// Nothing to catch the exception, so log it and then just stop processing, I guess
		this._cf.$log('Uncaught exception -- processing chain terminated with no continuation');
	}
	else {
		var abort = this._cf.abort_stack.pop();
		this._cf.abort_after = abort.after;
		abort.fn.apply(null, [this].concat(Array.prototype.slice.call(arguments)));
	}
}

/**
 * Function to catch an exception thrown within this environment, passing control back to the surviving
 * abort_after() handler. If no such handler exists, log an error and then terminate the chain, as there
 * are no real other options. The handler will be invoked with the environment variable as its first
 * argument, which makes it suitable for passing a Chain as a handler
 */
function cf_catch() {
	var after = this._cf.abort_after;

	if (after && after.apply) {
		after.apply(null);
	}
	else {
		this._cf.$log('Caught exception, but no after() exists -- processing chain terminated');
	}
}

/**
 * Wraps the after call in an error checking method that will throw if the first argument is not
 * undefined. This replaces a very frequent error checking snippet
 * Any arguments after the error check will be forwarded, if
 * present.
 *
 * This is exported to the environment as $check. You'd use it to replace code like this:
 * 
 * mysql.conn.query('SELECT * FROM `sample`', function(err, results) {
 * 	if (err) { env.$throw; }
 * 	else { after(results); }
 * });
 * 
 * which becomes:
 *
 * mysql.conn.query('SELECT * FROM `sample`', env.$check(after));
 *
 * Note that unlike env.$throw, which is passed as a function without evaluation, env.$check is
 * evaluated and its result is passed as the callback.
 */
function cf_check(after) {
	var that = this;
	return function(err) {
		if (err) {
			that.$throw(err);
		}
		else {
			after.apply(null, Array.prototype.slice.call(arguments, 1));
		}
	};
}

/**
 * A call context object, which is used to build the call graph for the execution of a chain
 * at run time, this stores a pair of pointers, one to the next call in the list and one to the
 * first child.
 * @param name The name to use when printing this context during a call trace
 */
function Context(name) {
	this.next = null;
	this.child = null;
	this.name = name;
}

/**
 * Head node for a context list, inserted automatically when a context is pushed onto the stack,
 * to start the list of subcalls within that context
 */
function ContextHead() {
	Context.call(this, '__ContextHead__');
}
ContextHead.prototype = new Context();
ContextHead.prototype.constructor = ContextHead;

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

	// In newer versions of nodejs:
	//this.defineProperty(this, 'length', {get : function() { return this.fns[0].params; }});
	this.__defineGetter__('length', function() {
		if (that.fns[0])
			return that.fns[0].params;
		return 0;
	});

	this.__defineGetter__('name', function() {
		if (that._name)
			return that._name;
		else
			return '(anonymous chain)';
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
	 * Sets a function to act as an abortion handler for this Chain. If env.$abort() is invoked, this
	 * handler will be called first, then any after() specified during apply(), and finally, it will
	 * attempt to pass the exception up the abortion tree, if it is not handled.
	 * @param fn A plain callback, it must take env as its first argument
	 */
	set_abort_handler : function(fn) {
		this.abort = fn;
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
	 * Provide a name for this callback chain, much like one would provide a name for a function,
	 * to aid in creating chain traces
	 * @param name The name for the callback chain
	 */
	set_name : function(name) {
		this._name = name;
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
		var after_name = after.name || '(lambda function)';

		// If after() is not already bound to env, we need to pass it along
		if (this.bind_after_env) {
			after = _.partial(after, env);
		}

		// Push exception information, if present
		if (this.abort) {
			// Push handler to exception handling stack
			env._cf.abort_stack.push({
				fn : this.abort,
				after : after
			});

			// Wrap after() to remove the exception handler from the stack when this chain's context ends
			// Note that this is not the same after() as was pushed to the stack, so if we experience an
			// exception, it will not pop two handlers--this version of after is only called if no exception
			// happens
			var _after = after;
			after = function() {
				env._cf.abort_stack.pop();
				_after();
			};
		}

		// Create callback chain
		var cb = _.reduceRight(this.fns, function(memo, v) {
			return [function() {
				var params = that.handle_args(env, v, Array.prototype.slice.call(arguments));

				// I thought about making this up to the end user to call in his functions, but in the
				// end I don't think we lose anything by simply always pushing these to the next tick,
				// even if they're fully synchronous functions that were chained together.
				process.nextTick(function() {
					// Catch exceptions inside the application and pass them to env.$throw instead
					try {
						env._cf.$push_call(memo[1]);
						v.fn.apply(v.ctx, [env, memo[0]].concat(params));
					}
					catch (err) {
						env.$throw(err);
					}
				});
			}, v.fn.name];
		}, [
			function() {
				// Remove this call chain's context from the stack, then call after with forwarded arguments
				env._cf.$pop_ctx();
				var params = Array.prototype.slice.call(arguments);
				after.apply(null, params);
			},
			after_name
		]);

		// Invoke chain, passing forward arguments received
		env._cf.$push_ctx(this.name);
		env._cf.$push_call(cb[1]);
		cb[0].apply(null, args.splice(2));
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
			return env._cf.stack.splice(-missing, missing).concat(args);
		else {
			// Push extra args to the stack, so for instance if passed arg1, arg2, and arg3,
			// but we only consume arg1, the stack will have [arg2, arg3] pushed to it and made
			// available to the next function if it needs additional arguments
			env._cf.stack = env._cf.stack.concat(args.splice(missing, -missing));
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

// Export our stuff
module.exports.Chain = Chain;
module.exports.mkfn = mkfn;
module.exports.mkenv = mkenv;
