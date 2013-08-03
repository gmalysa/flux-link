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
	fl.gen_dot = function(chain) {
		return _dot_inner(chain, true, {})[0].join('\n');
	}

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
			builder.push('}');
			return [builder, chain_entry, chain_exit];
		}
		else {
			// Just a normal function, return it in our results
			return [[], name, name];
		}

	}

	function get_chain_content(elem, names) {
		if (elem instanceof fl.Branch) {
			return handle_branch(elem, names);
		}
		else if (elem instanceof fl.ParallelChain) {
		}
		else if (elem instanceof fl.LoopChain) {
		}
		else if (elem instanceof fl.Chain) {
			return handle_chain(elem, names);
		}
		else {
			// A chain type we don't handle yet...shouldn't happen hopefully
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
		builder.push(cond[2]+' -> '+if_true[1]+' [label = true];');
		builder.push(cond[2]+' -> '+if_false[1]+' [label = false];');
		builder.push(if_true[2]+' -> '+terminator+';');
		builder.push(if_false[2]+' -> '+terminator+';');
		return [builder, cond[1], terminator];
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
			return [[], '__empty__', '__empty__'];
		}

		var builder = [];
		var node1 = _dot_inner(elem.fns[0], false, names);
		var first = node1;
		var node2;

		for (var i = 1; i < elem.fns.length; ++i) {
			Array.prototype.push.apply(builder, node1[0]);
			node2 = _dot_inner(elem.fns[i].fn, false, names);
			builder.push(node1[2]+' -> '+node2[1]+';');
			node1 = node2;
		}

		Array.prototype.push.apply(builder, node2[0]);
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
