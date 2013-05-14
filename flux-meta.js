/**
 * Definitions and functions for working with environment/execution metadata that we store
 * in order to emulate some of the features lost by using a pseudo-continuation passing
 * style of programming
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use granted under the terms of the MIT License. See LICENSE for details.
 */

var _ = require('underscore');

/**
 * Metadata is stored inside a class that provides all of the useful interface. You
 * should not access member data outside of here, but hey, if the interface is insufficient,
 * feel free to add to it as additional class-level behavior
 * @param env Pointer to the environment for which this tracks metadata (yes, a circular reference)
 * @param log Logging function to be called in the event of certain types of errors
 */
function FluxMeta(env, log) {
	_.extend(this, {
		stack : [],
		call_first : null,
		call_current : null,
		call_stack : [],
		exception_stack : [],
		exception_after : undefined,
		$log : log,
	});
}

// Member function definitions
_.extend(FluxMeta.prototype, {
	/**
	 * Pushes a value onto the stack
	 * @param val Value to push on the stack
	 */
	$push_stack : function(val) {
		this.stack.push(val);
	},

	/**
	 * Pops a value from the stack
	 * @return Mixed value popped from the stack
	 */
	$pop_stack : function() {
		return this.stack.pop();
	},

	/**
	 * Push a new handler onto the exception stack
	 * @param h The new exception handler to add
	 */
	$push_exception_handler : function(h, after) {
		this.exception_stack.push([h, after]);
	},

	/**
	 * Remove the topmost exception handler, either because an exception occurred or because the topmost
	 * context ended, and it is taking its handler with it.
	 * @return Function, exception handler to be called if necessary
	 */
	$pop_exception_handler : function() {
		var h = this.exception_stack.pop() || [];
		this.exception_after = h[1];
		return h[0];
	},

	/**
	 * Retrieves the current exception after call, if one is assigned
	 * @return Function, to be called after an exception is successfully handled by the most recent handler
	 */
	$get_exception_after : function() {
		return this.exception_after;
	},

	/**
	 * Pushes a new context onto the call stack, which is done whenever a new chain is entered. Each context
	 * tracks the function calls within that chain, but is removed after the chain exists, in order to simplify
	 * some of the "depth" if we need to print a backtrace.
	 * @param name The name of the chain creating a context
	 */
	$push_ctx : function(name) {
		if (this.call_first === null) {
			var ctx = new Context(name);
			this.call_current = ctx;
			this.call_first = ctx;
		}
	
		var ctx = new ContextHead();
		this.call_current.child = ctx;
		this.call_stack.push(this.call_current);
		this.call_current = ctx;
	},
	
	/**
	 * Pushes a function call into the current call context, which is done whenever a function within a chain
	 * is evaluated (regardless of type).
	 * @param name The name of the function call
	 */
	$push_call : function(name) {
		var ctx = new Context(name);
		this.call_current.next = ctx;
		this.call_current = ctx;
	},
	
	/**
	 * Pops the topmost context, done just before the after method is executed at the end of a chain
	 * Debating whether we should check the stack length before popping, and possibly reset the call_first
	 * pointer, etc., but the only time this could result in an invalid value is when popping the topmost
	 * call chain off the stack. An environment should never be re-used, so having bad state after that
	 * is not an issue, and we do get a trivially small performance improvement by not checking...
	 */
	$pop_ctx : function() {
		this.call_current = this.call_stack.pop();
	},

	/**
	 * Retrieves the complete execution trace up to this point as a flat array (rather than the convoluted
	 * call graph type structure it actually is
	 * @return Array Trace information, where each element is an array of [function name, depth]
	 */
	$get_exec_trace : function() {
		var et = [];

		function et_helper(ctx, depth) {
			if (ctx === null)
				return;

			if (!(ctx instanceof ContextHead))
				et.push([ctx.name, depth]);

			et_helper(ctx.child, depth+1);
			et_helper(ctx.next, depth);
		};

		et_helper(this.call_first, 0);
		return et;
	},
	
	/**
	 * Retrieves an abridged back trace up to this point as a flat array. This omits any calls that are not
	 * in the immediate hierarchy of the current call, to reduce the amount of information that is displayed.
	 * @return Array Trace information, where each element is an array of [function name, depth]
	 */
	$get_back_trace : function() {
		var bt = []
		var ctx = this.call_first;
		var depth = 0;
	
		while (ctx != null) {
			if (!(ctx instanceof ContextHead))
				bt.push([ctx.name, depth]);
			depth += (ctx.bt_depth_increase() ? 1 : 0);
			ctx = ctx.bt_get_next();
		}
	
		return bt;
	},

	/**
	 * Formats an execution trace as a call tree, which is sort of the logical inverse of a stack trace,
	 * when looked at graphically (i.e. the first function is at the top, rather than at the bottom)
	 * @param bt Array Trace information
	 * @return String Trace information formatted like a call tree
	 */
	$format_call_tree : function(bt) {
		return _.reduce(bt, function(memo, v) {
			return memo + '\n' + (new Array(1+v[1]).join('  ')) + v[0];
		}, '');
	},
	
	/**
	 * Format an execution trace (abridged or not) in a manner similar to a stack trace as produced by an
	 * Error object.
	 * @param bt Array Trace information
	 * @return String Trace formatted like a stack trace
	 */
	$format_stack_trace : function(bt) {
		var depth = 0;
		//var maxDepth = _.reduce(bt, function(memo, v) { return v[1] > memo ? v[1] : memo; }, 0);
	
		return _.reduceRight(bt, function(memo, v) {
			if (depth == v[1])
				loc = 'after ';
			else
				loc = 'in ';
			depth = v[1];
			return memo + '\n      ' + (new Array(1+depth).join('  ')) + loc + v[0];
		}, '');
	}

});

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

// Class methods for the Context
_.extend(Context.prototype, {
	/**
	 * When doing a backtrace traversal, retrieve the context that comes next, after this one,
	 * which collapses children of contexts that are not the inner-most, to avoid clutter.
	 * @return Context The next context in the most direct backtrace path
	 */
	bt_get_next : function() {
		if (this.next !== null)
			return this.next;
		else
			return this.child;
	},

	/**
	 * When doing a backtrace traversal, this tells us whether depth increased or not
	 * @return bool True if bt_next() returns this.child, false if this.next
	 */
	bt_depth_increase : function() {
		return this.next === null;
	}
});

/**
 * Head node for a context list, inserted automatically when a context is pushed onto the stack,
 * to start the list of subcalls within that context
 */
function ContextHead() {
	Context.call(this, '__ContextHead__');
}
ContextHead.prototype = new Context();
ContextHead.prototype.constructor = ContextHead;

// Replace exports with the constructor, because it is our only export
module.exports = FluxMeta;
