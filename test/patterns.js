var fl = require('../lib-cov/flux-link');

exports = {};

exports['map'] = function(test) {
	var input = [1, 2, 3];
	var result = [1, 4, 9];
	var sq = function(env, after, v, k, i, list) {
		after(v*v);
	};
	
	var chain = new fl.Chain(fl.p.map(sq),
		function(env, after, map_result) {
			test.deepEqual(result, map_result);
			after();
		});

	var env = new fl.Environment();
	test.expect(1);
	chain.call(null, env, test.done, input);
};

module.exports = exports;
