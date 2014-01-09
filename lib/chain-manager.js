/**
 * The chain manager is used to manage some globally shared state that
 * we use in a (futile?) attempt to increase performance by avoiding
 * duplication.
 *
 * (c) 2014, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use granted under the terms of the MIT License. See LICENSE for details
 */

var nextTick = process.nextTick;

// Still not sure if setImmediate or nextTick is faster
//if (typeof setImmediate == 'function')
//	nextTick = setImmediate;

var queue = new Array(1000);
var next = 0;
var tickSet = false;
var noargs = [];
var nullfn = function() {};

function queueTick(fn, args) {
	args = args || noargs;
	queue[next] = {fn : fn, args : args};
	next += 1;

	if (!tickSet) {
		nextTick(runTick);
		tickSet = true;
	}
}

function runTick() {
	var stop = next;
	for (var idx = 0; idx < next; ++idx) {
		queue[idx].fn.apply(null, queue[idx].args);
		queue[idx] = 0;
	}
	next = 0;
	tickSet = false;
}

module.exports.queueTick = queueTick;
module.exports.runTick = runTick;
