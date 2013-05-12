flux-link
=========

A callback management library for Node.js, designed to help manage program flow in callback-heavy situations

## Installation

Install via npm:

```
npm install flux-link
```

## Overview

Create chains of functions that should be called in sequence and require the use of callbacks to pass from one to the next. Additionally, a shared environment variable is provided to all callbacks, allowing them to approximate local shared state, along with support for exception-like behavior where the remainder of a callback chain can be skipped in the event of an error, invoking a handler.
