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
	 * Maps each element of the input array/object to a new value through the given fn,
	 * which can be a chain, and then passes the result as the first argument to the callback.
	 * This is a serial map, because sometimes that's how you want it to be.
	 * @param fn The function to use the mapping, must have (env, after, value, key, index, list) for a signature
	 * @param ctx The this argument with which to call the function during mapping
	 * @return Chain-ready function that can be used to do array/object mapping
	 */
	patterns['smap'] = function(fn, ctx) {
		ctx = ctx || null;

		// We return a function that can be placed directly into a chain
		return function smap(env, after, arr) {
			var result = new Array(arr.length);
			var pairs = _.pairs(arr);
			var i = 0;

			function __check(env, after) {
				if (i < result.length)
					after(true);
				else
					after(false, result);
			};

			function __map(env, after) {
				var elem = pairs[i];
				fn.call(ctx, env, after, elem[1], elem[0], i, arr);
			};

			function __save(env, after, res) {
				result[i] = res;
				i += 1;
				after();
			}

			var lc = new fl.LoopChain();
			lc.set_cond(__check);
			lc.push(__map);
			lc.push(__save);
			lc.call(null, env, after);
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

	/**
	 * Filters the given input array/object, only returning those values which pass a truth
	 * test. This tests each element of the given array in series, instead of allowing for
	 * a parallel run.
	 * @param fn The function to use for filtering
	 * @param ctx The thisarg for the filtering function, which defaults to null
	 */
	patterns['sfilter'] = function(fn, ctx) {
		ctx = ctx || null;

		return function sfilter(env, after, arr) {
			var pairs = _.pairs(arr);
			var filtered = [];
			var i = 0;

			function __check(env, after) {
				if (i < pairs.length)
					after(true);
				else
					after(false, filtered);
			};

			function __filter(env, after) {
				var elem = pairs[i];
				fn.call(ctx, env, after, elem[1], elem[0], arr);
			};

			function __save(env, after, test) {
				if (test)
					filtered.push(pairs[i][1]);
				i += 1;
				after();
			}

			var chain = new fl.LoopChain();
			chain.set_cond(__check);
			chain.push(__filter);
			chain.push(__save);
			chain.call(null, env, after);
		};
	};

	/**
	 * Calls the function with each element in the given array, but produces no output. Any
	 * arguments passed to the callback are ignored
	 * @param fn The function to call on each element
	 * @param ctx The thisarg for the aforementioned function, defaults to null
	 */
	patterns['each'] = function(fn, ctx) {
		ctx = ctx || null;

		function __each(env, after, list, orig_arr) {
			var elem = list[env._thread_id];
			fn.call(ctx, env, after, elem[1], elem[0], orig_arr);
		};

		// Chain-embeddable each function
		return function each(env, after, arr) {
			var pairs = _.pairs(arr);

			var chain = new fl.ParallelChain();
			for (var i = 0; i < arr.length; ++i) {
				chain.push(__each);
			}

			chain.call(null, env, after, pairs, arr);
		};
	};

	/**
	 * Calls the function with each element in the given array, but produces no output. Unlike
	 * the parallel version, this ensures serial processing of the array via the callbacks
	 * @param fn The function to call on each element
	 * @param ctx The thisarg for the aforementioned function, defaults to null
	 */
	patterns['seach'] = function(fn, ctx) {
		ctx = ctx || null;

		// Chain-embeddable result!
		return function seach(env, after, arr) {
			var pairs = _.pairs(arr);
			var i = 0;

			function __check(env, after) {
				after(i < pairs.length);
			};

			function __each(env, after) {
				var elem = pairs[i];
				i += 1;
				fn.call(ctx, env, after, elem[1], elem[0], arr);
			}

			var chain = new fl.LoopChain();
			chain.set_cond(__check);
			chain.push(__each);

			chain.call(null, env, after);
		};
	};

	/**
	 * Reduces the elements in the array/object to a single value by repeated callback
	 * application.
	 * @param fn The function to use for reduction
	 * @param ctx The thisarg for that function, defaults to null
	 */
	patterns['reduce'] = function(fn, ctx) {
		ctx = ctx || null;

		return function reduce(env, after, arr, initial) {
			var pairs = _.pairs(arr);
			var i = -1;

			function __check(env, after, memo) {
				i += 1;
				after(i < pairs.length, memo);
			};

			function __reduce(env, after, memo) {
				var elem = pairs[i];
				fn.call(ctx, env, after, memo, elem[1], elem[0], arr);
			};

			var chain = new fl.LoopChain();
			chain.set_cond(__check);
			chain.push(__reduce);
			chain.call(null, env, after, initial);
		};
	};

	/**
	 * Reduces the elements in the array/object to a single value by repeated callback
	 * application, but it starts at the "right side"--that is, the last element, and
	 * works backwards
	 * @param fn The function to use for reduction
	 * @param ctx The thisarg for that function, defaults to null
	 */
	patterns['reduceRight'] = function(fn, ctx) {
		ctx = ctx || null;

		return function reduce(env, after, arr, initial) {
			var pairs = _.pairs(arr);
			var i = pairs.length;

			function __check(env, after, memo) {
				i -= 1;
				after(i > -1, memo);
			};

			function __reduce(env, after, memo) {
				var elem = pairs[i];
				fn.call(ctx, env, after, memo, elem[1], elem[0], arr);
			};

			var chain = new fl.LoopChain();
			chain.set_cond(__check);
			chain.push(__reduce);
			chain.call(null, env, after, initial);
		};
	};
}

module.exports = gen_patterns;
