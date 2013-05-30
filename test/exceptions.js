var fl = require('../lib-cov/flux-link');

exports = {};

exports['env.$catch()'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			env.$throw(new Error('Catch in handler'));
		});
	chain.set_exception_handler(function(env, err) {
		env.$catch();
	})
	
	var env = new fl.Environment();
	chain.call(null, env, test.done);
}

module.exports = exports;
