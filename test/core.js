var fl = require('../lib-cov/flux-link');

exports = {};

exports['simple'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			test.ok(true);
			after();
		});
	var env = new fl.Environment();

	test.expect(1);
	chain.call(null, env, test.done);
}

exports['nested chains'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			test.ok(true);
			after();
		});
	var outer = new fl.Chain(chain, chain);
	var env = new fl.Environment();

	test.expect(2);
	outer.call(null, env, test.done);
}

exports['explicit parameters'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			test.ok(true);
			after(1);
		}, function(env, after, param) {
			test.equal(param, 1);
			after();
		});

	var env = new fl.Environment();
	test.expect(2);
	chain.call(null, env, test.done);
}

exports['stack parameters'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			env.$push(1);
			test.ok(true);
			after();
		},
		function(env, after, param) {
			test.equal(param, 1);
			after();
		});

	var env = new fl.Environment();
	test.expect(2);
	chain.call(null, env, test.done);
}

exports['chained explicit parameters'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			test.ok(true);
			after(1, 2);
		},
		function(env, after, param) {
			test.equal(param, 1);
			after();
		},
		function(env, after, param) {
			test.equal(param, 2);
			after();
		});
	
	var env = new fl.Environment();
	test.expect(3);
	chain.call(null, env, test.done);
}

exports['chained stack parameters'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			env.$push(1);
			env.$push(2);
			test.ok(true);
			after();
		},
		function(env, after, param) {
			test.equal(param, 2);
			after();
		},
		function(env, after, param) {
			test.equal(param, 1);
			after();
		});
	
	var env = new fl.Environment();
	test.expect(3);
	chain.call(null, env, test.done);
}

exports['caller initial parameters'] = function(test) {
	var chain = new fl.Chain(
		function(env, after, param) {
			test.equals(param, 10);
			after();
		});
	
	var env = new fl.Environment();
	test.expect(1);
	chain.call(null, env, test.done, 10);
}

exports['loop'] = function(test) {
	var chain = new fl.LoopChain(
		function(env, after) {
			test.ok(true);
			if (env.count > 0)
				after(true);
			else
				after(false);
		},
		function(env, after) {
			env.count -= 1;
			after();
		});
	
	var env = new fl.Environment({count : 3});
	test.expect(4);	// 4 checks, 3 iterations of the body
	chain.call(null, env, test.done);
}

exports['parallel'] = function(test) {
	var dec = function dec(env, after) {
		env._env.count -= 1;
		test.ok(true);
		after();
	};

	var pc = new fl.ParallelChain(dec, dec, dec, dec, dec);
	var chain = new fl.Chain(pc,
		function(env, after) {
			test.equals(env.count, 0);
			after();
		});
	
	var env = new fl.Environment({count : 5});
	test.expect(6);
	chain.call(null, env, test.done);
}

exports['parallel results array'] = function(test) {
	var sq = function sq(lenv, after) {
		after(lenv._thread_id * lenv._thread_id);
	}

	var pc = new fl.ParallelChain(sq, sq, sq);
	var chain = new fl.Chain(pc,
		function(env, after, results) {
			test.equals(results[0], 0);
			test.equals(results[1], 1);
			test.equals(results[2], 4);
			after();
		});

	var env = new fl.Environment();
	test.expect(3);
	chain.call(null, env, test.done);
}

exports['branch true'] = function(test) {
	var chain = new fl.Branch(
		function check(env, after, input) {
			after(input > 5);
		},
		function true_branch(env, after) {
			test.ok(true);
			after();
		},
		function false_branch(env, after) {
			test.ok(false);
			after();
		});
	
	test.expect(1);
	var env = new fl.Environment();
	chain.call(null, env, test.done, 10);
};

exports['branch false'] = function(test) {
	var chain = new fl.Branch(
		function check(env, after, input) {
			after(input > 5);
		},
		function true_branch(env, after) {
			test.ok(false);
			after();
		},
		function false_branch(env, after) {
			test.ok(true);
			after();
		});
	
	test.expect(1);
	var env = new fl.Environment();
	chain.call(null, env, test.done, 1);
};

module.exports = exports;
