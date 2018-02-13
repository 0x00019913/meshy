/* Halfedge data structure. */

function HDSHalfedge(node) {
  this.id = -1;
  // node at the start of this halfedge
  if (node!==undefined) {
    this.node = node;
    node.halfedge = this;
  }
  else {
    this.node = null;
  }
  // next halfedge CCW around the same face
  this.next = null;
  // twin halfedge
  this.twin = null;
}

HDSHalfedge.prototype.prev = function() {
  var twin = this.twin;

  while (twin.next != this) {
    if (!twin || !twin.next) return null;
    twin = twin.next.twin;
  }

  return twin;
}

HDSHalfedge.prototype.nstart = function() {
  return this.node;
}

HDSHalfedge.prototype.nend = function() {
  if (!this.next) return null;
  return this.next.node;
}

HDSHalfedge.prototype.rotated = function() {
  if (!this.twin) return null;
  return this.twin.next;
}



function HDSNode(v) {
  this.id = -1;
  // vertex
  this.v = v!==undefined ? v : null;
  // one of the 1+ halfedges starting at this node
  this.halfedge = null;
}

HDSNode.prototype.isolated = function() {
  return this.halfedge == null;
}

HDSNode.prototype.terminal = function() {
  return this.halfedge.twin.next == this.halfedge;
}



function HDSFace(he, f) {
  this.id = -1;
  // one of the halfedges on this face
  this.halfedge = he!==undefined ? he : null;
  // THREE.Face3 object
  this.f = f;
}



function HDS(sourceVertices, sourceFaces) {
  var vs = sourceVertices;
  var fs = sourceFaces;

  var nv = vs.length;
  var nf = fs.length;

  var nodes = new Array(nv);
  var halfedges = [];
  var faces = new Array(nf);

  this.nodes = nodes;
  this.halfedges = halfedges;
  this.faces = faces;

  // maps tuples of vertex indices (each signifying a CCW-directed edge) to a
  // halfedge array index
  var hemap = {};

  // prepopulate node array
  for (var i = 0; i < nv; i++) {
    nodes[i] = new HDSNode(vs[i]);
  }

  // populate face and
  for (var i = 0; i < nf; i++) {
    var face3 = fs[i];

    var a = face3.a;
    var b = face3.b;
    var c = face3.c;

    var heab = this.addHalfedge(a, b);
    var hebc = this.addHalfedge(b, c);
    var heca = this.addHalfedge(c, a);

    heab.next = hebc;
    hebc.next = heca;
    heca.next = heab;

    faces[i] = new HDSFace(heab, face3);
  }
}

HDS.prototype.addNode = function(v) {
  this.nodes.push(new HDSNode(v));
}

HDS.prototype.addFace = function(he) {
  this.faces.push(new HDSFace(he));
}

HDS.prototype.addHalfedge = function(a, b) {
  // create new halfedge from a to b
  var he = new HDSHalfedge(this.nodes[a]);

  var hemap = this.hemap;
  var hash = tupleHash(b, a);

  // if halfedge map has a twin for this halfedge, assign twins
  if (hemap.hasOwnProperty(hash)) {
    var twin = halfedges[hemap[hash]];

    twin.twin = he;
    he.twin = twin;
  }

  // store hashmap entry
  hemap[tupleHash(a, b)] = this.halfedges.length;

  // store halfedge
  this.halfedges.push(he);

  function tupleHash(i, j) { return i+"_"+j; }
}
