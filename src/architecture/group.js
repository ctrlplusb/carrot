const _ = require("lodash");
const methods = require('../methods/methods');
const config = require('../config');
const Node = require('./node');

/**
* A group instance denotes a group of nodes. Beware: once a group has been used to construct a network, the groups will fall apart into individual nodes. They are purely for the creation and development of networks.
*
* @constructs Group
*
* @param {number} [size=0] Amount of nodes to build group with
*
* @prop {Nodes[]} [nodes=[]] All nodes within the group
* @prop {Connection[]} [connections_incoming=[]] Incoming connections
* @prop {Connection[]} [connections_outgoing=[]] Outgoing connections
* @prop {Connection[]} [connections_self=[]] Self connections
*
* @example
* let { Group } = require("@liquid-carrot/carrot");
*
* // A group with 5 nodes
* let A = new Group(5);
*/
function Group(size) {
  const self = this;

  // Important:
  // The order of the nodes dictates the ideal order of activation
  self.nodes = [];
  self.connections_self = [];
  self.connections_incoming = [];
  self.connections_outgoing = [];

  for (let index = 0; index < size; index++) {
    self.nodes.push(new Node());
  }

  /**
  * Activates all the nodes (neurons) in the group
  *
  * @function activate
  * @memberof Group
  *
  * @param {number[]} inputs Array of inputs (numbers) for the group - _order matters._
  *
  * @returns {number[]} Squashed output values
  *
  * @example
  * let { Group } = require("@liquid-carrot/carrot");
  *
  * let group = new Group(3);
  *
  * group.activate([1, 0, 1]);
  */
  self.activate = function(inputs) {
    if (inputs != undefined && inputs.length !== self.nodes.length) throw new RangeError('Array with values should be same as the amount of nodes!');

    const outputs = [];

    for (let index = 0; index < self.nodes.length; index++) {
      const activation = inputs == undefined ? self.nodes[index].activate() : self.nodes[index].activate(inputs[index]);

      outputs.push(activation);
    }

    return outputs;
  },

  /**
  * Will backpropagate all the node in the group -- make sure the group receives input from another group or node.
  *
  * [Momentum](https://www.willamette.edu/~gorr/classes/cs449/momrate.html) adds a fraction of the previous weight update to the current one.
  * If you combine a high learning rate with a lot of momentum, you will rush past the minimum with huge steps. It is therefore often necessary to reduce the global learning rate µ when using a lot of momentum (m close to 1).
  *
  * @function propagate
  * @memberof Group
  *
  * @param {number|number[]} [target] Ideal value(s) - _required for output nodes_
  * @param {Object} [options]
  * @param {number} [options.rate] [Learning rate](https://towardsdatascience.com/understanding-learning-rates-and-how-it-improves-performance-in-deep-learning-d0d4059c1c10)
  * @param {number} [options.momentum] [Momentum](https://www.willamette.edu/~gorr/classes/cs449/momrate.html) adds a fraction of the previous weight update to the current one. When the gradient keeps pointing in the same direction, this will increase the size of the steps taken towards the minimum.
  * @param {boolean} [options.update=true]
  *
  * @returns {Array<{responsibility: number, projected: number, gated: number}>} The errors created by backpropagating
  *
  * @example
  * let { Group } = require("@liquid-carrot/carrot");
  *
  * let A = new Group(2);
  * let B = new Group(3);
  *
  * // Connects group A to group B - creating a "little network"
  * A.connect(B);
  *
  * // Activates the "little network"
  * A.activate([1,0]);
  * B.activate();
  *
  * // Teaches the network
  * B.propagate([0,1,0.2]);
  * A.propagate();
  */
  self.propagate = function(target, options) {
    if (!options && _.isPlainObject(target)) {
      options = target;
      target = undefined;
    }

    if (target != undefined && target.length !== self.nodes.length) throw new RangeError('Array with values should be same as the amount of nodes!');

    const errors = [];
    for (let index = self.nodes.length - 1; index >= 0; index--) {
      if (target == undefined) errors.push(self.nodes[index].propagate(options));
      else errors.push(self.nodes[index].propagate(target[index], options));
    }

    return errors;
  },

  /**
  * Connects the nodes in this group to nodes in another group or just a node
  *
  * @function connect
  * @memberof Group
  *
  * @param {Group|Layer|Node} target Node(s) to form connections to
  * @param {connection} method [Connection Method](connection), determines how the nodes in this group will connect to the target (e.g. one-to-one, all-to-all)
  * @param {number} weight Weight of the connection(s)
  *
  * @returns {Connection[]} The formed connections
  *
  * @example
  * let { Group } = require("@liquid-carrot/carrot");
  *
  * let A = new Group(4);
  * let B = new Group(5);
  *
  * A.connect(B, methods.connection.ALL_TO_ALL); // specifying a method is optional
  */
  self.connect = function(target, method, weight) {
    const self_targeted = target.nodes ? self.nodes == target.nodes : false;
    // in the future this check could be replaced by id checking (source.id == target.id)

    // set a default for method, although it should be provided
    if (method == undefined) {
      if (self_targeted) {
        if (config.warnings) console.warn('No group connection specified, using ONE_TO_ONE');
        method = methods.connection.ONE_TO_ONE;
      } else {
        if (config.warnings) console.warn('No group connection specified, using ALL_TO_ALL');
        method = methods.connection.ALL_TO_ALL;
      }
    }

    // Check type of target, assign source and target nodes
    // when inherited, the children may add the properties input_nodes and output_nodes
    let sources = self.output_nodes ? self.output_nodes : self.nodes
    let targets = target.input_nodes
      ? target.input_nodes
      : (target.nodes)
      ? target.nodes
      : (target instanceof Node)
      ? [target]
      : null

    if(!target) throw new TypeError("Type of target not supported")

    // lengths should match if one to one
    if (method === methods.connection.ONE_TO_ONE && sources.length !== targets.length) {
      throw new RangeError("One-to-one connections requrire equal number of source and target nodes");
    }

    // Store connections in networks
    const connect = (self_targeted)
      ? (conn) => self.connections_self.push(conn)
      : (conn) => { self.connections_outgoing.push(conn); target.connections_incoming.push(conn); }

    const formed = []; // stores raw connections, backwards compatibility
    const store = (conn) => { connect(conn); formed.push(conn); }

    for (let i = 0; i < targets.length; i++) {
      if (method === methods.connection.ONE_TO_ONE) store(sources[i].connect(targets[i], weight))

      else {
        if (method === methods.connection.ALL_TO_ELSE && (new Set(sources)).has(targets[i])) continue

        for (let j = 0; j < sources.length; j++) { store(sources[j].connect(targets[i], weight)) }
      }
    }

    return formed
  },

  /**
  * Make nodes from this group gate the given connection(s) between two other groups. You have to specify a [Gating Method](gating)
  *
  * @function gate
  * @memberof Group
  *
  * @param {Connection[]|Connection} connections Connections to gate
  * @param {gating} method [Gating Method](gating)
  */
  self.gate = function(connections, method) {
    if (method == undefined) throw new TypeError('Please specify Gating.INPUT, Gating.OUTPUT');

    if (!Array.isArray(connections)) connections = [connections];

    const nodes_from = [];
    const nodes_to = [];

    let i, j;

    for (i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (!nodes_from.includes(connection.from)) nodes_from.push(connection.from);
      if (!nodes_to.includes(connection.to)) nodes_to.push(connection.to);
    }

    switch (method) {
      case methods.gating.INPUT:
        for (i = 0; i < nodes_to.length; i++) {
          const node = nodes_to[i];
          const gater = self.nodes[i % self.nodes.length];

          for (j = 0; j < node.connections_incoming.length; j++) {
            const connection = node.connections_incoming[j];
            if (connections.includes(connection)) {
              gater.gate(connection);
            }
          }
        }
        break;
      case methods.gating.OUTPUT:
        for (i = 0; i < nodes_from.length; i++) {
          const node = nodes_from[i];
          const gater = self.nodes[i % this.nodes.length];

          for (j = 0; j < node.connections_outgoing.length; j++) {
            const connection = node.connections_outgoing[j];
            if (connections.includes(connection)) {
              gater.gate(connection);
            }
          }
        }
        break;
      case methods.gating.SELF:
        for (i = 0; i < nodes_from.length; i++) {
          const node = nodes_from[i];
          const gater = self.nodes[i % self.nodes.length];

          if (connections.includes(node.connections_self)) {
            gater.gate(node.connections_self);
          }
        }
    }
  },

  /**
  * Sets the value of a property for every node
  *
  * @function set
  * @memberof Group
  *
  * @param {object} values A configuration object
  * @param {number} values.bias [Weight bias](https://deepai.org/machine-learning-glossary-and-terms/bias-vector)
  * @param {activation} values.squash [Activation function](https://medium.com/the-theory-of-everything/understanding-activation-functions-in-neural-networks-9491262884e0)
  *
  * @example
  * let { Group } = require("@liquid-carrot/carrot");
  *
  * var group = new Group(4);
  *
  * // All nodes in 'group' now have a bias of 1
  * group.set({bias: 1});
  */
  self.set = function(options_to_set) {
    if (typeof options_to_set !== 'object') throw TypeError(`options_to_set has to be an object with the properties to set and the desired values`);
    for (let index = 0; index < self.nodes.length; index++) {
      Object.assign(self.nodes[index], options_to_set);
    }
  },

  /**
  * *INCOMPLETE* Disconnects all nodes from this group from another given group/node.
  *
  * @function disconnect
  * @memberof Group
  *
  * @param {Group|Node} target Node(s) to remove connections to/from
  * @param {boolean} [twosided=false] Set to true, to disconnect both to and from connections simultaneously (applies to two-sided [Connections](Connection) only)
  */
  self.disconnect = function(target, twosided) {
    twosided = twosided || false;

    if (target instanceof Group) {
      for (let i = 0; i < self.nodes.length; i++) {
        for (let j = 0; j < target.nodes.length; j++) {
          self.nodes[i].disconnect(target.nodes[j], { twosided });

          if (twosided) {
            self.connections_incoming = self.connections_incoming.filter(connection => {
              // this is a quick patch, there shouldnt be undefines here
              if (!connection) return false;
              return !(connection.from === target.nodes[j] && connection.to === this.nodes[i])
            });
          }
          self.connections_outgoing = self.connections_outgoing.filter(connection => {
            // this is a quick patch, there shouldnt be undefines here
            if (!connection) return false;
            return !(connection.from === self.nodes[i] && connection.to === target.nodes[j]);
          });
        }
      }
    }
    else if (target instanceof Node) {
      for (let index = 0; index < self.nodes.length; index++) {
        self.nodes[index].disconnect(target, { twosided });

        if (twosided) self.connections_incoming = self.connections_incoming.filter(connection => !(connection.from === target && connection.to === self.nodes[index]));
        self.connections_outgoing = self.connections_outgoing.filter(connection => !(connection.from === self.nodes[index] && connection.to === target));
      }
    }
  },

  /**
  * Clear the context of the nodes in this group
  *
  * @function clear
  * @memberof Group
  *
  * @returns {Group} The group itself
  */
  self.clear = function() {
    for (let index = 0; index < self.nodes.length; index++) {
      self.nodes[index].clear();
    }
    return self;
  }

  /**
   * Add the nodes to the group
   * @param  {Node|Node[]|Group} nodes_to_add The nodes to add
   * @return {Group} A self reference for chaining
   */
  self.addNodes = function(nodes_to_add) {
    if (nodes_to_add instanceof Node) nodes_to_add = [nodes_to_add];
    else if (nodes_to_add instanceof Group) nodes_to_add = nodes_to_add.nodes;
    self.nodes.push(...nodes_to_add);
  }
}

module.exports = Group;
