function DirectedAdjacencyMap(p, axis) {
  this.axis = axis;
  this.ah = cycleAxis(axis);
  this.av = cycleAxis(this.ah);
  this.up = makeAxisUnitVector(axis);

  this.p = p || 1e9;
  this.map = {};
}

DirectedAdjacencyMap.prototype.addEdge = function(v1, v2, normal) {
  var v1hash = vertexHash(v1, this.p);

  var m = this.map;

  if (!m.hasOwnProperty(v1hash)) m[v1hash] = new AdjacencyMapNode(v1);

  var node = m[v1hash];

  node.addNeighbor(v2);
}

// one node signifies one vertex
// if count == 0, the node has no neighbor and is either isolated or at the end
// of a (directed) chain of edges
// if count == 1, the node points to one neighbor and a traversal can go to
// that neighbor
// if count > 1, the node has multiple outgoing directed paths; in that case,
// neighbor information is recorded in the neighbors array
function AdjacencyMapNode(v) {
  this.v = v;
  this.count = 0;
  this.neighbor = null;

  // array of neighbor vertices
  this.neighbors = null;
}

// if no neighbors, set neighbor to nv
// if 1+ neighbors already exist, push to neighbors array (init if necessary)
AdjacencyMapNode.prototype.addNeighbor = function(nv) {
  var v = this.v;

  if (this.count === 0) neighbor = nv;
  else {
    if (this.count === 1) {
      this.neighbors = [];
      this.neighbors.push(this.neighbor);

      this.neighbor = null;
    }

    this.neighbors.push(nv);
  }

  this.count++;
}

AdjacencyMapNode.prototype.removeNeighbor = function(v) {
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
    var idx = this.neighbors.indexOf(v);

    // if found neighbor, get it and remove it from neighbors array
    if (idx > 1) {
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
