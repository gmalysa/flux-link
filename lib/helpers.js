/**
 * Helper functions that are used in the other modules to reduce the number of times
 * that code for common tasks is rewritten
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use granted under the terms of the MIT License. See LICENSE for details.
 */

/**
 * Retrieves the name for a function, using fn.name to determine what it is, or if no
 * name is given (i.e. an anonymous function), returns altname. If altname is ALSO not
 * given, returns (anonymous), as a final default value.
 * @param fn Function whose name we want to find
 * @param altname Optional string, name to use if the function was anonymous
 * @return String name of the function
 */
module.exports.fname = function(fn, altname) {
	if (fn.name)
		return fn.name;
	if (altname)
		return altname;
	return '(anonymous)';
}

/**
 * Checks if a function name should be hidden from the call graph because it is an
 * internal function. This is a small hack, but it helps remove internals from the
 * call graph, which simplifies the view for the end user working with his code, all
 * of which exists outsie the library.
 * @param name The function name to test
 * @return bool True if this function name should not be pushed
 */
module.exports.hide_function = function(name) {
	if (name == '__after_glue' || name == '__chain_inner')
		return true;
	return false;
}
