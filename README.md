flux-link
=========

A control flow management library for Node.js, designed to help manage program flow in callback-heavy situations.

## Installation

Install via npm:

```
npm install flux-link
```

## Overview

Create chains of functions that should be called in sequence and require the use of callbacks to pass from one to the next. Additionally, a shared environment variable is provided to all callbacks, allowing them to approximate local shared state, along with support for exception-like behavior where the remainder of a callback chain can be skipped in the event of an error, invoking a handler that may catch or re-throw the exception farther up the stack.

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

Then, to execute a chain, create an execution environment, and call the chain like a function. Due to limitations in javascript's syntax (i.e. no overloading operator() for non-functions), for now you must use chain.call or chain.apply to call a chain. Note that the first argument to Function.call() is generally an execution context. Chain objects will ignore this argument, but it is still required for consistency with the function prototype.

```javascript
    var env = new fl.Environment({}, console.log);
    chain.call(null, env, null);
```

Chains have the same function interface as the functions that are used to build them--they require two parameters, an environment, and an 'after' callback. However, if no after is provided, the Chain will gracefully terminate execution, rather than throwing an error. As a result of having the same interface, chains can be used within other chains, allowing you to define segments of code as individual chains, and then string them together however you like:

```javascript
    var chain2 = new fl.Chain(chain, chain, chain);
```

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

## API Listing
```javascript
// Global functions
fl.Chain(function [, function [, ...]])
fl.Environment(initial_properties, log_function)
fl.mkfn(function, arg_count [, name [, context]])

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
```




