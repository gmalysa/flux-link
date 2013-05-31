/**
 * Common usage patterns and recipes for making chains that deal with
 * data. These do not, in general, evaluate arguments. Instead, they create and return
 * a Chain that can then be used to evaluate arguments further
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use granted under the terms of the MIT License. See LICENSE for details.
 */

var _ = require('underscore');

/**
 * Generates the patterns and stores them in the given map; this is used to overcome circular
 * dependencies in the instantiation of library stuff while including this file IN that library.
 * @param fl module definition
 * @param patterns fl.p module variable, to be populated with patterns
 */
function gen_patterns(fl, patterns) {
	/**
	 * Maps each element of the input array/object to a new value through the fn given
	 * (it can be a chain), and then passes the result as the first argument to cb. This
	 * a parallel map, because that is the best kind of map.
	 * @param fn The function to use to do the mapping, must have (env, after, value, key, index, list) for a signature
	 * @param ctx The this argument with which to call the function during mapping
	 * @return Chain-ready function that can be used to do array/object mapping
	 */
	patterns['map'] = function(fn, ctx) {
		ctx = ctx || null;
	
		// This actually does the work of mapping each element to a new one
		function __map(lenv, after, list, orig_arr) {
			var elem = list[lenv._thread_id];
			fn.call(ctx, lenv, after, elem[1], elem[0], lenv._thread_id, orig_arr);
		}

		// We return a function that can be placed directly into a chain
		return function map(env, after, arr) {
			var pairs = _.pairs(arr);

			// Create chain with a bunch of parallel map calls, one per item
			var chain = new fl.ParallelChain();
			for (var i = 0; i < pairs.length; ++i) {
				chain.push(__map);
			}
	
			// Call the chain, and the results will be passed forward as the first argument to after
			chain.call(null, env, after, pairs, arr);
		};
	};

	/**
	 * Filters the given input array/object, returning only those values which pass a truth
	 * test. This can be embedded in a chain, just like map can be.
	 * @param fn The function to use for filtering
	 * @param ctx The thisarg for the filtering function, defaults to null
	 */
	patterns['filter'] = function(fn, ctx) {
		ctx = ctx || null;

		// Actual function that does the filtering
		function __filter(lenv, after, list, orig_arr, result) {
			var elem = list[lenv._thread_id];
			function __f2(inc) {
				if (inc)
					result.push(elem[1]);
				after();
			}
			fn.call(ctx, lenv, __f2, elem[1], elem[0], orig_arr);
		}

		// Chain-embeddable function
		return function filter(env, after, arr) {
			var pairs = _.pairs(arr);
			var filtered = [];

			// Like with map, push an instance of the filter worker per item in the array
			var pchain = new fl.ParallelChain();
			for (var i = 0; i < arr.length; ++i) {
				pchain.push(__filter);
			}

			// But we have to wrap it in a serial chain that'll forward the result
			var chain = new fl.Chain(pchain,
				function (env, after) {
					after(filtered);
				});

			chain.call(null, env, after, pairs, arr, filtered);
		};
	};
}

module.exports = gen_patterns;
