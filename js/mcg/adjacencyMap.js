MCG.AdjacencyMap = (function() {

  function AdjacencyMap(attributes) {
    this.attributes = attributes;

    this.axis = attributes.axis;
    this.ah = attributes.ah;
    this.av = attributes.av;
    this.up = attributes.up;

    this.precision = attributes.precision;
    this.epsilon = attributes;
  }

  return AdjacencyMap;

})();

MCG.DirectedAdjacencyMap = (function() {

  function DirectedAdjacencyMap(attributes) {
    MCG.AdjacencyMap.call(this, attributes);

    this.map = {};
  }

  DirectedAdjacencyMap.prototype.addSegment = function(s) {
    var hash1 = s.p1.hash();

    var m = this.map;

    if (!m.hasOwnProperty(hash1)) {
      m[hash1] = new MCG.AdjacencyMapNode(s.p1, this.attributes);
    }

    var node = m[hash1];

    node.addNeighbor(s.p2);
  }

  // get the key to a node with only one neighbor; a loop starts here
  DirectedAdjacencyMap.prototype.getKey = function() {
    var res = null;
    var m = this.map;

    for (var key in m) {
      if (m[key].count === 1) {
        res = key;
        break;
      }
    }

    return res;
  }

  // return a closed loop of points
  // NB: this mutates the adjacency map
  DirectedAdjacencyMap.prototype.getLoop = function() {
    var m = this.map;

    var start = this.getKey();
    if (start === null) return null;

    var current = start;
    var prevpt = null;
    var loop = [];

    do {
      var node = m[current];
      loop.push(node.pt);

      console.log(node.pt);

      var npt = node.nextPoint(prevpt);

      if (npt === null) return null;

      var next = npt.hash();

      if (node.count === 0) delete m[current];

      prevpt = node.pt;
      current = next;
    } while (current !== start);

    return loop;
  }

  // return as many loops as the adjacency map has
  // NB: this mutates the adjacency map
  DirectedAdjacencyMap.prototype.getLoops = function() {
    var m = this.map;
    var loops = [];

    while (!objectIsEmpty(m)) {
      var loop = this.getLoop();
      if (loop === null) break;

      loops.push(loop);
    }

    return loops;
  }

  return DirectedAdjacencyMap;
})();

MCG.AdjacencyMapNode = (function() {

  // one node signifies one Point; a neighbor is another Point
  // if count == 0, the node has no neighbor and is either isolated or at the end
  // of a (directed) chain of edges
  // if count == 1, the node points to one neighbor and a traversal can go to
  // that neighbor
  // if count > 1, the node has multiple outgoing directed paths; in that case,
  // neighbor information is recorded in the neighbors array
  function AdjacencyMapNode(pt, attributes) {
    this.pt = pt;
    this.count = 0;
    this.neighbor = null;

    this.up = attributes.up;
    this.epsilon = attributes.epsilon;

    // array of neighbor vertices
    this.neighbors = null;
  }

  // if no neighbors, set neighbor to npt
  // if 1+ neighbors already exist, push to neighbors array (init if necessary)
  AdjacencyMapNode.prototype.addNeighbor = function(npt) {
    var pt = this.pt;

    if (this.count === 0) this.neighbor = npt;
    else {
      if (this.count === 1) {
        this.neighbors = [];
        this.neighbors.push(this.neighbor);

        this.neighbor = null;
      }

      this.neighbors.push(npt);
    }

    this.count++;
  }

  // get the neighbor's point:
  //  if there is one neighbor, return that
  //  if there are multiple neighbors, take the rightmost possible turn
  AdjacencyMapNode.prototype.nextPoint = function(prevpt) {
    if (this.count < 1) {
      return null;
    }
    else {
      var p = null;

      if (this.count === 1) p = this.neighbor;
      else p = this.getRightmostNeighbor(prevpt);

      var result = p !== null ? this.removeNeighbor(p) : null;

      return result;
    }
  }

  AdjacencyMapNode.prototype.removeNeighbor = function(pt) {
    var n = null;

    // only one neighbor; get it and null out the current neighbor
    if (this.count === 1) {
      n = this.neighbor;
      this.neighbor = null;
      this.count--;
    }
    // multiple neighbors
    else if (this.count > 1) {
      // find neighbor
      var idx = this.neighbors.indexOf(pt);

      // if found neighbor, get it and remove it from neighbors array
      if (idx > -1) {
        n = this.neighbors[idx];
        this.neighbors.splice(idx, 1);
        this.count--;

        // if 1 neighbor left, move it to .neighbor and null out neighbors
        if (this.count === 1) {
          this.neighbor = this.neighbors[0];
          this.neighbors = null;
        }
      }
    }

    return n;
  }

  AdjacencyMapNode.prototype.getRightmostNeighbor = function(prevpt) {
      var neighbors = this.neighbors;
      var pt = this.pt;

      var inDir = prevpt.vectorTo(pt);
      var right = inDir.cross(this.up);

      var anglemax = 0;
      var anglemaxidx = -1;

      for (var ni = 0; ni < neighbors.length; ni++) {
        var npt = neighbors[ni];

        var d = pt.vectorTo(npt);
        var angle = inDir.angleTo(d);

        // correct for angles greater than pi
        if (d.dot(right) > 0) angle = 2*Math.PI - angle;

        if (angle > 2*Math.PI) angle = 0;

        if (angle >= anglemax) {
          anglemax = angle;
          anglemaxidx = ni;
        }
      }

      var p = anglemaxidx > -1 ? neighbors[anglemaxidx] : null;

      console.log(anglemax/Math.PI/2, anglemaxidx, shallowCopy(neighbors), p);

      return p;
  }

  return AdjacencyMapNode;

})();
