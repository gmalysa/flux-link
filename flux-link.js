/**
 * Library for chaining together functions to implement some control flow functionality that
 * helps alleviate the issues of callback nesting, by generating glue between functions that
 * represent "basic block"-like portions of program code. Each chain has both array-like and
 * function-like behavior, allowing it to be invoked with apply(), or manipulated prior to
 * invocation with array functions. Chains can be used multiple times with different
 * environment objects, allowing them to be created once and then reused.
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
 * Creates/extends an object suitable to use as an environment by initializing the stack
 * @param env Optional base environment to update with a stack
 * @param log Function to use to log critical errors (like when $throw() is called with no exception handlers)
 * @return environment object to be passed to chain.apply
 */
function mkenv(env, log) {
	env = env || {};
	return _.extend(env, {
		_cf : {
			stack : [],
			abort_stack : [],
			abort_after : null,
			$log : log
		},
		$throw : _.bind(cf_throw, env),
		$catch : _.bind(cf_catch, env)
	});
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
		// Nothing to catch the exception, so log it and then just stop processing
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
 * Creates an object that represents a series of functions that will be called sequentially
 * These functions must have "prototype" information given through mkfn. This is because fn.length
 * is not a reliable way to get the number of arguments. For instance, if _.partial() or _.bind()
 * are used to save a context, fn.length will produce zero, even though there are additional required
 * arguments for the wrapped function. That said, if someone passes a function instead of the result
 * from mkfn(), we will try to wrap it as best we can, and so we have to trust Function.length
 * @param fns Array of functions to form the chain, with definitions given by mkfn()
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
	 * Implement a function-like interface by providing the apply method to invoke the chain
	 * @todo Fix stack argument passing, the current approach is (maybe) wrong!
	 * @param ctx Normally a "context" in which to call this function. Ignored here
	 * @param args The arguments to this chain. The first should be an environment, the second should be
	 *             an optional callback. Anything after that is forwarded on the stack to the first method
	 */
	apply : function(ctx, args) {
		var env = args[0];
		var after = args[1] || _.identity;

		if (this.bind_after_env) {
			after = _.partial(after, env);
		}

		// Push abortion information, if present
		if (this.abort) {
			env._cf.abort_stack.push({
				fn : this.abort,
				after : after
			});
		}

		// Create callback chain
		var cb = _.reduceRight(this.fns, function(memo, v) {
			return function() {
				var missing = v.params - arguments.length;
				var params = Array.prototype.slice.call(arguments);
				
				// Get missing args from the stack
				if (missing > 0) {
					params = env._cf.stack.splice(-missing, missing).concat(params);
				}
				else if (missing < 0) {
					// Push extra args to the stack
					env._cf.stack = env._cf.stack.concat(params.splice(missing, -missing));
				}

				// Catch exceptions inside the application and pass them to env.$throw instead
				try {
					v.fn.apply(v.ctx, [env, memo].concat(params));
				}
				catch (err) {
					env.$throw(err);
				}
			};
		}, after);

		// Invoke chain, passing forward arguments received
		cb.apply(null, args.splice(2));
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
		this.fns.splice(pos, 0, fn);
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
