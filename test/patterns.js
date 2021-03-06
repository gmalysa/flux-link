var fl = require('../lib-cov/flux-link');
var _ = require('underscore');

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

exports['smap'] = function(test) {
	var input = [1, 2, 3];
	var result = [1, 4, 9];
	var sq = function(env, after, v, k, i, list) {
		after(v*v);
	};
	
	var chain = new fl.Chain(fl.p.smap(sq),
		function(env, after, map_result) {
			test.deepEqual(result, map_result);
			after();
		});

	var env = new fl.Environment();
	test.expect(1);
	chain.call(null, env, test.done, input);
}

exports['filter'] = function(test) {
	var input = [1, 2, 3, 4];
	var result = [2, 4];
	var filt = function(env, after, v, k, list) {
		after(v % 2 == 0);
	};

	var chain = new fl.Chain(fl.p.filter(filt),
		function(env, after, filter_result) {
			test.equal(_.difference(result, filter_result).length, 0);
			after();
		});

	var env = new fl.Environment();
	test.expect(1);
	chain.call(null, env, test.done, input);
};

exports['sfilter'] = function(test) {
	var input = [1, 2, 3, 4];
	var result = [2, 4];
	var filt = function(env, after, v, k, list) {
		after(v % 2 == 0);
	};

	var chain = new fl.Chain(fl.p.sfilter(filt),
		function(env, after, filter_result) {
			test.equal(_.difference(result, filter_result).length, 0);
			after();
		});

	var env = new fl.Environment();
	test.expect(1);
	chain.call(null, env, test.done, input);
};

exports['each'] = function(test) {
	var input = [1, 2, 3, 4];
	var each = function(env, after, v, k, list) {
		test.equals(v, input[k]);
		after();
	};

	var env = new fl.Environment();
	test.expect(4);
	fl.p.each(each)(env, test.done, input);
};

exports['seach'] = function(test) {
	var input = [1, 2, 3, 4];
	var each = function(env, after, v, k, list) {
		test.equals(v, input[k]);
		after();
	};

	var env = new fl.Environment();
	test.expect(4);
	fl.p.seach(each)(env, test.done, input);
};

exports['reduce'] = function(test) {
	var input = [1, 2, 3, 4];
	var r = function(env, after, memo, v, k, list) {
		after(memo + v);
	};

	var chain = new fl.Chain(fl.p.reduce(r),
		function(env, after, result) {
			test.equals(result, 10);
			after();
		});

	var env = new fl.Environment();
	test.expect(1);
	chain.call(null, env, test.done, input, 0);
};

exports['reduceRight'] = function(test) {
	var input = ['a', 'b', 'c', 'd'];
	var r = function(env, after, memo, v, k, list) {
		after(memo+v);
	};

	var chain = new fl.Chain(fl.p.reduceRight(r),
		function(env, after, result) {
			test.equals(result, 'dcba');
			after();
		});
	
	var env = new fl.Environment();
	test.expect(1);
	chain.call(null, env, test.done, input, '');
};

module.exports = exports;
