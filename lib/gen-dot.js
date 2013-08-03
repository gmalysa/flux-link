/**
 * Convert a chain into a text representation in the DOT language, in order to
 * visualize a chain or group of chains as a static execution graph.
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use granted under the terms of the MIT License. See LICENSE for details.
 */

var helpers = require('./helpers');

// Use the same trick as patterns to hook this into the main lib while getting a reference to it
module.exports = function(fl) {
	/**
	 * Interface function used to generate a description of the chain in the DOT
	 * language
	 * @param chain A flux-link chain object to describe
	 * @return String a string representation of the chain in DOT
	 */
	fl.gen_dot = function(chain) {
		return _dot_inner(chain, true, {})[0].join('\n');
	}

	/**
	 * Inner worker function used to build the actual DOT description
	 * @param elem The element to describe
	 * @param make_digraph Should this node be instantiated as a digraph or subgraph cluster
	 * @param names The hash table of functions and their names that have been seen
	 * @return Standard triple of [strings, first element, last element]
	 */
	function _dot_inner(elem, make_digraph, names) {
		var builder = [];
		var name = hash_name_get(elem, names);

		// Only push graphs/clusters for chains
		if (elem instanceof fl.ChainBase) {
			if (make_digraph)
				builder.push('digraph '+name+' {');
			else
				builder.push('subgraph cluster_'+name+' {');
			builder.push('label = '+name+';');

			// Get the graph content for this chain, then add it
			var nest = get_chain_content(elem, names);
			Array.prototype.push.apply(builder, nest[0]);
			var chain_entry = nest[1];
			var chain_exit = nest[2];

			// Also insert special header node to indicate entry
			if (make_digraph) {
				var header = hash_name_get({name : 'Global Start'}, names);
				builder.push(header+' [shape=doublecircle];');
				builder.push(header+' -> '+chain_entry+';');
				builder.push(chain_exit+' [shape=doublecircle];');
			}

			builder.push('}');
			return [builder, chain_entry, chain_exit];
		}
		else {
			// Just a normal function, return it in our results
			return [[], name, name];
		}

	}

	/**
	 * Breakout function that simply calls the correct handler based on the type
	 * of the element supplied
	 * @param elem A chain-type object to get a dot description for
	 * @param names The hash table of functions and names that we've seen
	 * @return Standard triple of [strings, first element, last element]
	 */
	function get_chain_content(elem, names) {
		if (elem instanceof fl.Branch) {
			return handle_branch(elem, names);
		}
		else if (elem instanceof fl.ParallelChain) {
			return handle_parallel(elem, names);
		}
		else if (elem instanceof fl.LoopChain) {
			return handle_loop(elem, names);
		}
		else if (elem instanceof fl.Chain) {
			return handle_chain(elem, names);
		}
		else {
			// A chain type we don't handle yet...shouldn't happen hopefully
			return [[], hash_name_get({name : 'unidentified'}), hash_name_get({name : 'unidentified'})];
		}
	}

	/**
	 * Handle a branch-type chain, which includes fancy decision labels and
	 * formatting
	 * @param elem The branch element
	 * @param names The hash table of names we've seen
	 * @return Standard triple of [strings, first element, last element]
	 */
	function handle_branch(elem, names) {
		var cond = _dot_inner(elem.cond.fn, false, names);
		var if_true = _dot_inner(elem.if_true.fn, false, names);
		var if_false = _dot_inner(elem.if_false.fn, false, names);
		var terminator = hash_name_get({name : 'branch_end'}, names);
		var builder = [];

		Array.prototype.push.apply(builder, cond[0]);
		Array.prototype.push.apply(builder, if_true[0]);
		Array.prototype.push.apply(builder, if_false[0]);
		builder.push(cond[2]+' [shape=Mdiamond];');
		builder.push(cond[2]+' -> '+if_true[1]+' [label = true];');
		builder.push(cond[2]+' -> '+if_false[1]+' [label = false];');
		builder.push(if_true[2]+' -> '+terminator+';');
		builder.push(if_false[2]+' -> '+terminator+';');
		builder.push(terminator+' [shape=octagon];');
		return [builder, cond[1], terminator];
	}

	/**
	 * Handle a parallel chain, which inserts head and footer nodes around
	 * the functions in the middle
	 * @param elem The parallel chain to describe in DOT
	 * @param names The hash table of functions and their names
	 * @return Standard triple of [strings, first element, last element]
	 */
	function handle_parallel(elem, names) {
		var phead = hash_name_get({name : 'parallel_head'}, names);
		var ptail = hash_name_get({name : 'parallel_tail'}, names);
		var node;
		var builder = [];

		for (var i = 0; i < elem.fns.length; ++i) {
			node = _dot_inner(elem.fns[i].fn, false, names);
			Array.prototype.push.apply(builder, node[0]);
			builder.push(phead+' -> '+node[1]+';');
			builder.push(node[2]+' -> '+ptail+';');
		}

		builder.push(phead+' [shape=house];');
		builder.push(ptail+' [shape=invhouse];');
		return [builder, phead, ptail];
	}

	/**
	 * Handle a loop chain, which is a lot like a serial chain but with a starter
	 * condition node on top
	 * @param elem The loop chain to describe in DOT
	 * @param names The hash table of functions and their names
	 * @return Standard triple of [strings, first element, last element]
	 */
	function handle_loop(elem, names) {
		var cond = _dot_inner(elem.cond.fn, false, names);
		var node1 = _dot_inner(elem.fns[0].fn, false, names);
		var builder = [];
		var node2 = node1;

		Array.prototype.push.apply(builder, cond[0]);
		Array.prototype.push.apply(builder, node1[0]);
		builder.push(cond[2]+' [shape=Mdiamond];');
		builder.push(cond[2]+' -> '+node1[1]+' [label = true];');

		for (var i = 1; i < elem.fns.length; ++i) {
			node2 = _dot_inner(elem.fns[i].fn, false, names);
			Array.prototype.push.apply(builder, node2[0]);
			builder.push(node1[2]+' -> '+node2[1]+';');
			node1 = node2;
		}

		builder.push(node2[2]+' -> '+cond[1]+';');
		return [builder, cond[1], cond[2]];
	}

	/**
	 * Handle a serial chain of function, which just pushes each node with an
	 * edge to the next node in the chain
	 * @param elem The chain to pull elements from
	 * @param names The hash table of names that we've seen
	 * @return Standard triple of [strings, first element, last element]
	 */
	function handle_chain(elem, names) {
		// Make sure the chain does something
		if (elem.fns.length === 0) {
			return [[], hash_name_get({name : '__empty__'}), hash_name_get({name : '__empty__'})];
		}

		var builder = [];
		var node1 = _dot_inner(elem.fns[0].fn, false, names);
		var first = node1;
		var node2;

		for (var i = 1; i < elem.fns.length; ++i) {
			Array.prototype.push.apply(builder, node1[0]);
			node2 = _dot_inner(elem.fns[i].fn, false, names);
			builder.push(node1[2]+' -> '+node2[1]+';');
			node1 = node2;
		}

		Array.prototype.push.apply(builder, node1[0]);
		return [builder, first[1], node2[2]];
	}

	/**
	 * Retrieve the proper name to use in the graph, for a given element. If it doesn't
	 * exist in the hash table given, then it is added, and its allocated name is returned
	 * @param elem The element (chain or function) to look up in the hash table
	 * @param names The hash table to use to resolve and store names
	 * @return Properly formatted name for the given element
	 */
	function hash_name_get(elem, names) {
		var fname;
		if (elem.fn !== undefined)
			fname = format_name(helpers.fname(elem, elem.fn.name));
		else
			fname = format_name(elem.name);
		var list = names[fname];

		// First unique instance of a function gets to use its proper name
		if (list === undefined) {
			names[fname] = [{fn : elem, name : fname, count : 0}];
			return fname;
		}

		// Search the linear chain for our element
		for (var i = 0; i < list.length; ++i) {
			if (list[i].fn === elem) {
				list[i].count += 1;
				return list[i].name+'__'+list[i].count;
			}
		}

		// Not in the list yet, add it with a unique name index
		fname = fname+'_'+list.length;
		list.push({fn : elem, name : fname, count : 0});
		return fname;
	}

	/**
	 * Formats a chain name properly for display by replacing weird characters
	 * from DOT's perspective with underscores
	 * @param name The name to format
	 * @return String the safely formatted name
	 */
	function format_name(name) {
		return name.replace(/[ \(\)]/g, '_');
	}

};
