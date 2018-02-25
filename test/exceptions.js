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

exports['exception chaining if unhandled'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			env.$throw(new Error('exception!'));
		});
	var oc = new fl.Chain(chain);
	oc.set_exception_handler(function(env, err) {
		env.$catch();
	});

	var env = new fl.Environment();
	oc.call(null, env, function() { test.ok(true); test.done(); });
}

exports['exception error argument'] = function(test) {
	var err = {};
	var chain = new fl.Chain(
		function(env, after) {
			err = new Error('Test error');
			env.$throw(err);
		});
	
	chain.set_exception_handler(function(env, recErr) {
		test.ok(Object.is(err, recErr));
		env.$catch();
	});

	var env = new fl.Environment();
	chain.call(null, env, test.done);
}

exports['exception nesting arguments'] = function(test) {
	var err = {};
	var chain = new fl.Chain(
		new fl.Chain(
			function(env, after) {
				err = new Error('Test error');
				env.$throw(err);
			}
		)
	);
	
	chain.set_exception_handler(function(env, recErr) {
		test.ok(Object.is(err, recErr));
		env.$catch();
	});

	var env = new fl.Environment();
	chain.call(null, env, test.done);
}

exports['bind_after_env applies in exception'] = function(test) {
	var chain = new fl.Chain(
		function(env, after) {
			env.testval = 1;
			after();
		},
		function(env, after) {
			env.$throw(new Error('throw error'));
		});
	chain.set_bind_after_env(true);

	chain.set_exception_handler(function(env, arr) {
		env.$catch();
	});

	var env = new fl.Environment();
	env.testval = 0;
	chain.call(null, env, function(env) {
		test.equals(env.testval, 1);
		test.done();
	});
}

module.exports = exports;
