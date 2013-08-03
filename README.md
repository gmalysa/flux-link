flux-link
=========

A control flow management library for Node.js, designed to help manage program flow in callback-heavy situations. This is not an implementation of promises, and it has a very different theoretical approach to the problem.

## Installation

Install via npm:

```
npm install flux-link
```

## Overview

Create chains of functions that should be called in sequence and require the use of callbacks to pass from one to the next. Additionally, a shared environment variable is provided to all callbacks, allowing them to approximate local shared state, along with support for exception-like behavior where the remainder of a callback chain can be skipped in the event of an error, invoking a handler that may catch or re-throw the exception farther up the stack.

Additionally, chains can be created whose functions execute in parallel, or that form a loop, allowing for complex graphs to be created once and then executed for many different data sets.

## Usage

Using flux-link is designed to be simple. To begin, create an execution chain, consisting of zero or more functions to be called in series:

```javascript
var fl = require('flux-link');

var chain = new fl.Chain(
    function a(env, after) {
        env.a = true;
        after();
    },
    function b(env, after) {
        if (env.a)
            console.log('Called after a()');
        env.b = true;
        after();
    });
```

Each function in a chain must accept an environment variable as its first argument, and a successor function, generally called 'after,' as its second argument. Don't worry--the internals of flux-link will provide these arguments to each function at call time, so when 'after' is called, it need only be invoked with the arguments that you wish to provide it.

Then, to execute a chain, create an execution environment, and call the chain like a function with the environment. Due to limitations in javascript's syntax (i.e. no overloading operator() for non-functions), for now you must use chain.call or chain.apply to call a chain. Note that the first argument to Function.call() is generally an execution context (thisarg, the this pointer's value inside the functions). Chain objects will ignore this argument, but it is still required for consistency with the function prototype.

```javascript
    var env = new fl.Environment();
    chain.call(null, env, null);
```

Chains have the same function interface as the functions that are used to build them--they require two parameters, an environment, and an 'after' callback. However, if no after is provided, the Chain will gracefully terminate execution, rather than throwing an error. As a result of having the same interface, chains can be used within other chains, allowing you to define segments of code as individual chains, and then string them together however you like:

```javascript
    var chain2 = new fl.Chain(chain, chain, chain);
```

Three other types of chains also exist. The first is the LoopChain, which is used to create chains whose bodies will be executed as many times as a condition function evaluates to true, structurally similar to an asynchronous while loop. The condition and the body can both be functions or chains, accepting the environment and after as their first parameters. Additional parameters can be specified used appropriately. When the loop chain is called, excess parameters will be passed to the condition function, and excess parameters produced by the condition function will be passed to the loop body. Note: The loop body's final statement **must** produce new parameters for the condition, if arguments are used. Passing arguments through loops is considered an advanced feature; you should use environment-local variables instead for simplicity.

```javascript
    var lc = new fl.LoopChain(
        function cond(env, after) {
            after(env.inx++ < env.stuff.length);
        },
        function print(env, after) {
            console.log(env.stuff[env.inx]);
            after();
        });
```

Will print out each element of env.stuff, assuming that env.inx was properly initialized beforehand. _TBD:_ It seems reasonable to add an initializer function that is called before the first call to the condition function, increasing the flexibility of the LoopChain and removing the need for an additional wrapper. This may be changed in a future patch to introduce this behavior.

Next, a ParallelChain also exists, which executes all of its functions in parallel.  It passes a special environment pointer to its members: it is private to each parallel "thread," with an embedded pointer `_env` that references the "global" execution environment. Each thread-local environment also has `lenv._thread_id`, a numerical identifier that is assigned when the environment is created. It is guaranteed to be unique and counts up from 1 to the total number of parallel elements in the chain. The parallel chain does not actually use threads; the functions execute in the single node.js execution environment, but it is convenient to refer to them as separate threads as they are intended to be superficially similar.

If any of the functions in the parallel chain produce results (by passing arguments to after()), then an array is created and all of the produced results are stored, indexed by the thread id that produced them. This result array is then passed to the next function after the parallel chain.

```javascript
    function pc_body(env, after) { console.log(env._thread_id); }
    var pc = new ParallelChain(pc_body, pc_body, pc_body);
    pc.call(null, env, null);
```

produces ```1 2 3```. The order of execution in a parallel chain is not specified or guaranteed, but in practice they are at least initially called in order.

Finally, a Branch also exists (I've dropped the -Chain suffix here because it seems awkward as it reflects a fork more than a chain, physically), which allows you to specify asynchronous decision points with easy encapsulation for entire execution paths (i.e. if the user is logged in, run this chain to add account info to the page, otherwise run another chain to add a registration link, then, in either case, continue on with the main execution path). This isn't strictly necessary for use, but I found that it came up as a common pattern, and introducing the Branch class reduces the amount of glue necessary to implement it.

Branches are really simple. If the asynchronous condition/test function produces true, then the first alternative is executed, and then control flow is passed to the Chain-level after. If it instead produces false, then the second alternative is executed, and then control flow is passed to the Chain-level after, again. Example code for the situation described above:

```javascript
    var register = new fl.Chain(); // Chain to display registration info
    var loggedIn = new fl.Chain(); // Chain to display account info
    var branch = new fl.Branch(
        function(env, after) {
            // Assuming user.isLoggedIn is a synchronous function that checks a status flag on the given object and returns true or false, which we pass forward asynchronously
            after(user.isLoggedIn(env.user));
        },
        loggedIn,
        register);

    // ... Add the branch to the normal page processing flow and call it as usual
````

## Function Arguments and the Stack
One important aspect of flux-link is that an internal pseudo-stack is maintained, which can be used for passing arguments to functions. This is used to augment the normal function passing semantics that are also available. For example,

```javascript
    var c = new fl.Chain(
        function a(env, after) {
            after(1, 2);
        },
        function add(env, after, a, b) {
            env.$push(a+b);
            after();
        },
        function show_result(env, after, result) {
            console.log(result);
            after();
        });
    c.call(null, env, null);
```

Values may be pushed to the stack by calling the env.$push(), and values may be retrieved from the stack by calling env.$pop(). Obviously, the stack is not limited to passing arguments, and you may use it freely inside a function as a normal stack.

Chains themselves also respect the passing of arguments, so if a Chain object is invoked with more than two arguments, the rest will be passed to the first function in the Chain, allowing it to appear transparent to the execution of the program.

Finally, when functions are added to a Chain, the length property is used to determine how many arguments the function requires. This means that functions with variable numbers of arguments cannot reliably have their arguments determined and should use env.$pop() internally to acquire their parameters. Furthermore, some functions may have an incorrect length property, such as any function that has been wrapped with _.partial() or _.bind(), which may take a fixed number of additional arguments, but will always read as length 0. To circumvent this, when adding such a function to a Chain, use fl.mkfn() to provide additional information:

```javascript
function add(a, b) { return a+b; }

var addOne = new fl.Chain(fl.mkfn(_.parial(add, 1), 1));
```

fl.mkfn() can supply a lot of metadata that may be important for your function. It accepts up to four arguments, the function, the number of arguments, the name of the function to display, and a javascript context (i.e. this object) with which to invoke the function. The last two arguments are optional.

## Helper Functions (aka patterns)

Helper functions exist to perform several functional tasks using the asynchronous framework of flux-link. Currently, each, map, reduce, reduceRight, and filter are available. Each and map are both parallel versions, but serial versions will be added soon. Helper functions are defined in the "pattern" interface, accessible through `fl.p`. Complete examples for all patterns can be found in the test/ folder, but an overview is given here.

Each pattern wraps a function to produce a value that can be embedded in a chain, expects one argument, and passes zero or one arguments (as appropriate) to the next function in the chain. The patterns operate on "collections" rather than arrays, meaning they will also work to with objects, iterating over the properties in the same manner as underscore.js (which is used internally to provide this behavior). Therefore, the key argument and the index argument are not guaranteed to be the same, if an object is being iterated over. For example, using the map pattern, we can create a snippet that squares every element in a given object

```javascript
    function sq(env, after, value, key, index, list) {
        after(value*value);
    }
    var pc = new fl.Chain(fl.p.map(sq));
    var env = new fl.Environment();
    pc.call(null, env, function(result) { console.log(result);}, [1, 2, 3]);
```

will produce

```
[1, 4, 9]
```

When embedding a pattern in a chain, it takes two arguments: the function to be used to fulfill the pattern (i.e. the function that does the mapping, filtering, etc on a per-element basis), and an optional thisarg for that function, defaulting to null. When the chain evaluates the pattern during execution, it will call the provided function. Efforts have been made to match the ES5 specifications for the function signatures for each, map, filter, reduce, and reduceRight, with the exception that two additional parameters are provided **before** the other arguments, the familiar env and after arguments. Additionally, by default, map, filter, and each are implemented as a parallel evaluation. If you need or would like a serial version, there is smap, seach, and sfilter, which are identical, except that they complete processing for each element before starting the next one.

Be careful: all callbacks used for patterns must have a signature that accepts the correct total number of parameters. That is, functions used with map must accept env, after, value, key, index, and list, even if they are not used by the function. This is due to limitations in the automatic argument supplementation which does not handle optional arguments (yet). If you do not accept all of the required arguments for a function, then they will be pushed to the stack, which is not strictly negative but is likely undesirable.

## Exceptions

flux-link supports exception generation and handling through a separate exception stack, and it coerces normal exceptions that may be generated inside a built-in function into using the same semantics as exceptions that it produces. To throw a new exception, simply call env.$throw(error_object). Additional arguments may be provided (an extension of normal exception semantics), and they will be forwarded to the handler as well. If you call env.$throw(), do not call after(), or this will produce unexpected behavior (realistically, the rest of your Chain will then execute either once or twice depending on what your handler does).

Exception handlers are defined on a per-chain level, so that if an exception happens within the chain, the handler will be invoked, and control flow will pass to the after() that was supplied to the Chain. If an exception happens, it is not possible to resume inside the Chain, only after the Chain. Compare a Chain to a single synchronous function with a catch block at its end.

An exception handler should take a minimum of two arguments, the execution Environment as the first argument, and the thrown error as the second. If additional arguments were supplied to env.$throw(), they will be passed to the handler as well. Inside the handler, if it has actually handled the exception, it should call env.$catch() to indicate this--execution will then pass back to the next after() handler. If the exception could not or should not be handled, it should be re-thrown by calling env.$throw() again, which will invoke the next handler in the exception stack.

Handlers are added to chains by calling ```c.set_exception_handler(handler)```.

## Back Traces and Call Traces

Dealing with callback heavy code is not only annoying to write, it is also difficult to debug. The use of process.nextTick() to break up I/O bound code and allow other events to be handled breaks up the stack frames, which makes it hard to determine how code arrived at its current location. To deal with this problem, flux-link provides the ability to generate back traces and complete call traces at will.

Call traces are very complete pictures of the functions executed within the context of one environment. They will list all of the function calls made by the Chain, recursing into nested Chains. Note that other function calls are not included; only those which are made as part of a chain are listed. Calls made within the body of a function are omitted because we have no way (currently/ever) to hook into their execution. A back trace is a more abridged version of the same information--only the most direct route from the top of the call tree to the currently executing function is retrieved, which skips over the contents of sibling Chains.

Four functions are provided, two to generate call and back traces, one to string format either type of trace like a stack trace (most recent on top), and one to string format either type of trace like a call tree (most recent on bottom).

```javascript
// Tracing API
env.$get_exec_trace();
env.$get_back_trace();
env.$format_stack_trace(trace);
env.$format_call_tree(trace);
```

Additionally, whenever an exception is passed to env.$throw(), a back trace will be generated, parsed as a stack trace, and added as err.backtrace, to mimic the behavior of the existing err.stack property.

## DOT Graph Export

Finally, you may generate a representation of the entire control flow graph defined using a series of flux-link chains in the DOT language. Then, using the GraphViz package, you can convert this into a nice picture that captures the control flow of your program at the source level, to aid in debugging, or simply to have made into a poster for your office wall after the product launches.

Simply add one call to ```fl.gen_dot``` with the chain whose graph representation you wish to generate as its argument, somewhere in your code. The resulting string can then be saved or passed to dot to produce an actual graph. The process is very fast, so you could simply add this to the startup code for your server to make sure that your source graph is always in sync with the version of code running.

```javascript
var chain = new fl.Chain();
// ... Fill in the chain here ...
console.log(fl.gen_dot(chain));
```

```
$ node server > graph.dot
$ dot -Tpng -O graph.dot
```

Of course, this requires that GraphViz (and as a result dot) are installed on your system.

## API Listing
```javascript
// Global functions
fl.Chain(function [, function [, ...]])
fl.LoopChain(condition function, function [, function [, ...]])
fl.ParallelChain(function [, function [, ...]))
fl.Branch(condition function, if_true function, if_false function)
fl.Environment(initial_properties, log_function)
fl.mkfn(function, arg_count [, name [, context]])
fl.gen_dot(chain)

// Chain methods
Chain.call(ctx, env, after [, args ...])
Chain.apply(ctx, arg_array) // arg array must be [env, after, ...]
Chain.set_exception_handler(handler)
Chain.set_bind_env(bool) // If true, pass env to after() as first parameter
Chain.insert(fn, pos)
Chain.remove(pos)
Chain.push(fn)
Chain.pop()
Chain.shift()
Chain.unshift(fn)

// LoopChain methods
LoopChain.set_cond(cond_function)

// Environment methods
Environment.$push(val)
Environment.$pop()
Environment.$throw(err)
Environment.$catch()
Environment.$check(after)
Environment.$get_exec_trace()
Environment.$get_back_trace()
Environment.$format_call_tree()
Environment.$format_stack_trace()

// Helpers/patterns
fl.p.map(function, ctx)
fl.p.smap(function, ctx)
fl.p.filter(function, ctx)
fl.p.sfilter(function, ctx)
fl.p.reduce(function, ctx)
fl.p.reduceRight(function, ctx)
fl.p.each(function, ctx)
fl.p.seach(function, ctx)
```




