var fl = require('../flux-link');

exports = {};

exports['simple'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			after();
		});
	var env = new fl.Environment();
	chain.call(null, env, test.done);
}

exports['nested chains'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			after();
		});
	var outer = new fl.Chain(chain, chain);

	var env = new fl.Environment();
	outer.call(null, env, test.done);
}

exports['explicit parameters'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			after(1);
		}, function(env, after, param) {
			test.equal(param, 1);
			after();
		});

	var env = new fl.Environment();
	chain.call(null, env, test.done);
}

exports['stack parameters'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			env.$push(1);
			after();
		},
		function(env, after, param) {
			test.equal(param, 1);
			after();
		});

	var env = new fl.Environment();
	chain.call(null, env, test.done);
}

exports['chained explicit parameters'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
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
	chain.call(null, env, test.done);
}

exports['chained stack parameters'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			env.$push(1);
			env.$push(2);
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
	chain.call(null, env, test.done);
}

module.exports = exports;
