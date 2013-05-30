/**
 * Definition for the environment class, which is used to track and store the shared
 * state during program execution. Also includes the LocalEnvironment class, which
 * is used within async/parallel code to provide an equivalent of thread-local
 * storage
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use granted under the terms of the MIT License. See LICENSE for details.
 */

var _ = require('underscore');
var FluxMeta = require('./flux-meta');
var helpers = require('./helpers');

var slice = Array.prototype.slice;

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
 */
function Environment(env, log) {
	env = env || {};
	log = log || console.log;
	_.extend(this, env, {
		_fm : new FluxMeta(this, log)
	});

	// Bind member methods so that they can be passed as callbacks
	this.$throw = this.$throw.bind(this);
	this.$catch = this.$catch.bind(this);
}

// Instance methods for Environment
_.extend(Environment.prototype, {
	/**
	 * Pushes a value to the parameter stack, which is part of the internal metadata.
	 * @param value Any, the value to push to the stack
	 */
	$push : function(value) {
		this._fm.$push_stack(value);
	},
	
	/**
	 * Pops a value from the parameter stack.
	 * @return topmost value from the stack
	 */
	$pop : function() {
		return this._fm.$pop_stack();
	},
	
	/**
	 * Function to throw an exception within an environment, calling the topmost handler on the exception 
	 * stack. Optional arguments are allowed, and they will be passed to the handler after the required
	 * error object.
	 * @param err Error object to throw, or a message if not
	 * @param varargs Forwarded arguments to the first handler
	 */
	$throw : function(err) {
		var h = this._fm.$pop_exception_handler();
		err.backtrace = this._fm.$format_stack_trace(this._fm.$get_back_trace());
		
		if (h === undefined) {
			// There is no handler on the stack, so log the error and then die, because we have no choice
			this._fm.$log('Uncaught exception -- processing chain terminated');
			this._fm.$log('Backtrace: ' + err.backtrace);
		}
		else {
			// Update the call graph with changes to context and function calls before moving on
			this._fm.$push_call('env.$throw');

			// Call the handler, finally
			h.apply(null, [this].concat(slice.call(arguments)));
		}
	},
	
	/**
	 * Function to catch an exception thrown within this environment, passing control back to the surviving
	 * after() handler. If no such handler exists, log an error and then terminate the chain, as there
	 * are no real other options. The handler should already have the environment bound into it, because
	 * it will not be provided.
	 */
	$catch : function() {
		var after = this._fm.$get_exception_after();
		
		if (after === undefined) {
			this._fm.$log('Caught exception, but no after() exists -- processing chain terminated');
			this._fm.$log('Backtrace: ' + this._fm.$format_stack_trace(this._fm.$get_back_trace()));
		}
		else {
			// Update the call graph so that we can tell the exception was caught, as well
			this._fm.$push_call('env.$catch');
			if (!helpers.hide_function(helpers.fname(after)))
				this._fm.$push_call(helpers.fname(after));
			after.apply(null);
		}
	},
	
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
	$check : function(after) {
		return (function (err) {
			if (err) {
				this.$throw(err);
			}
			else {
				after.apply(null, slice.call(arguments, 1));
			}
		}).bind(this);
	},

	/**
	 * Retrieve a complete trace of the execution that used this environment variable
	 * @return Array Trace information, where each element is a pair of function name and call depth
	 */
	$get_exec_trace : function() {
		return this._fm.$get_exec_trace();
	},

	/**
	 * Retrieve a backtrace that provides a more abridged view of how execution got to where it is now
	 * @return Array Trace information, where each element is a pair of function name and call depth
	 */
	$get_back_trace : function() {
		return this._fm.$get_back_trace();
	},

	/**
	 * Proxy for formatting a trace as a call graph via the meta object
	 * @see FluxMeta.$format_call_tree()
	 */
	$format_call_tree : function(bt) {
		return this._fm.$format_call_tree(bt);
	},

	/**
	 * Proxy for formatting a trace as a stack trace via the meta object
	 * @see FluxMeta.$format_stack_trace()
	 */
	$format_stack_trace : function(bt) {
		return this._fm.$format_stack_trace(bt);
	}

});

/**
 * The LocalEnvironment class, which is the same as an environment class, except that it is
 * unique to each "thread" in parallel execution chains, similar to thread-local storage.
 * It has a pointer to the shared state, so that it may still be accessed.
 * @param env The environment variable to use as parent
 * @param id The thread id, this is used to track when all threads complete
 */
function LocalEnvironment(env, id) {
	Environment.call(this, {}, env._fm.$log);
	this._env = env;
	this._thread_id = id;
}
LocalEnvironment.prototype = new Environment();
LocalEnvironment.prototype.constructor = LocalEnvironment;
_.extend(LocalEnvironment.prototype, {
	/**
	 * Redefine the back trace to stack this trace with the inner environment's trace
	 * @return Array Trace information, where each element is a pair of function name and call depth
	 */
	$get_exec_trace : function() {
		var inner = this._env.$get_exec_trace();
		var mine = this._fm.$get_exec_trace();
		return inner.concat(mine);
	},

	/**
	 * Redefine the back trace to stack this trace with the inner environment's trace
	 * @return Array Trace information, where each element is a pair of function name and call depth
	 */
	$get_back_trace : function() {
		var inner = this._env.$get_back_trace();
		var mine = this._fm.$get_back_trace();
		return inner.concat(mine);
	}
});

// Replace the exports object with the new class, because it is all we want to share
module.exports.Environment = Environment;
module.exports.LocalEnvironment = LocalEnvironment;
