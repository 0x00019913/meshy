// HDS.js
//
// dependencies:
//  three.js
//
// description:
//  halfedge data structure built from a THREE.Mesh
//
// classes:
//  HDS

var HDS = (function() {

  function HDSHalfedge(vertex) {
    // vertex at the start of this halfedge
    if (vertex !== undefined) {
      this.vertex = vertex;
      vertex.halfedge = this;
    }
    else {
      this.vertex = null;
    }

    // next halfedge CCW around the same face
    this.next = null;

    // twin halfedge
    this.twin = null;

    // HDS face to the left of this halfedge
    this.face = null;
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
    return this.vertex;
  }

  HDSHalfedge.prototype.nend = function() {
    if (!this.next) return null;
    return this.next.vertex;
  }

  HDSHalfedge.prototype.rotated = function() {
    if (!this.twin) return null;
    return this.twin.next;
  }



  function HDSVertex(v) {
    this.id = -1;

    // vertex
    this.v = v!==undefined ? v : null;
    // one of the 1+ halfedges starting at this vertex
    this.halfedge = null;
  }

  HDSVertex.prototype.isolated = function() {
    return this.halfedge == null;
  }

  HDSVertex.prototype.terminal = function() {
    return this.halfedge.twin.next == this.halfedge;
  }



  function HDSFace(he) {
    this.id = -1;

    // one of the halfedges on this face
    this.halfedge = he!==undefined ? he : null;
  }



  function HDSFaceArray(vs) {
    this.vs = vs;
    this.faces = [];
    this.count = 0;
    this.area = 0;
  }

  HDSFaceArray.prototype.addFace = function(face) {
    // add face
    this.faces.push(face);
    this.count++;
    this.area += faceGetArea(face.face3, this.vs);
  }



  function HDS(mesh, p) {
    // precision factor
    p = p || 1e5;
    this.p = p;

    this.mesh = mesh;

    // halfedge structures
    var vertices = [];
    var halfedges = [];
    var faces = [];

    // for determining uniqueness
    var vmap = {};
    var hemap = {};

    // traverse each face in the mesh and build the halfedge structure
    Compute.traverseFaces(mesh, function(va, vb, vc, normal, idx) {
      var hva = addVertex(va);
      var hvb = addVertex(vb);
      var hvc = addVertex(vc);

      var face = new HDSFace(null);
      face.id = faces.length;
      faces.push(face);

      var heab = addHalfedge(hva, hvb, face);
      var hebc = addHalfedge(hvb, hvc, face);
      var heca = addHalfedge(hvc, hva, face);

      heab.next = hebc;
      hebc.next = heca;
      heca.next = heab;

      face.halfedge = heab;
    }, true); // true to store object-space geometry

    this.vertices = vertices;
    this.halfedges = halfedges;
    this.faces = faces;

    // internal functions

    function addVertex(v) {
      var vhash = Compute.vectorHash(v, p);

      if (vmap.hasOwnProperty(vhash)) {
        return vmap[vhash];
      }
      else {
        var vertex = new HDSVertex(v);
        vertex.id = vertices.length;
        vertices.push(vertex);
        vmap[vhash] = vertex;

        return vertex;
      }
    }

    function addHalfedge(hvi, hvj, face) {
      var halfedge = new HDSHalfedge(hvi);

      halfedges.push(halfedge);

      var twinhash = tupleHash(hvj.id, hvi.id);

      // if twin is present, assign twins
      if (hemap.hasOwnProperty(twinhash)) {
        var twin = hemap[twinhash];

        halfedge.twin = twin;
        twin.twin = halfedge;
      }

      hemap[tupleHash(hvi.id, hvj.id)] = halfedge;

      halfedge.face = face;

      return halfedge;
    }

    function tupleHash(i, j) { return i + "_" + j; }

    return;

    var vs = sourceVertices;
    var fs = sourceFaces;

    this.vs = vs;

    var nv = vs.length;
    var nf = fs.length;

    var vertices = new Array(nv);
    var halfedges = [];
    var faces = new Array(nf);

    this.vertices = vertices;
    this.halfedges = halfedges;
    this.faces = faces;

    // maps tuples of vertex indices (each signifying a CCW-directed edge) to a
    // halfedge array index
    var hemap = {};

    // prepopulate node array
    for (var n = 0; n < nv; n++) {
      vertices[n] = new HDSVertex(vs[n]);
    }

    // populate face and halfedge arrays
    for (var f = 0; f < nf; f++) {
      var face3 = fs[f];

      var face = new HDSFace(null, face3);
      face.id = f;
      faces[f] = face;

      var a = face3.a;
      var b = face3.b;
      var c = face3.c;

      var heab = addHalfedge(a, b);
      var hebc = addHalfedge(b, c);
      var heca = addHalfedge(c, a);

      heab.next = hebc;
      hebc.next = heca;
      heca.next = heab;

      face.halfedge = heab;
    }

    /*function addHalfedge(i, j) {
      // create new halfedge from i to j
      var he = new HDSHalfedge(vertices[i]);

      var hash = tupleHash(j, i);

      // if halfedge map has a twin for this halfedge, assign their .twins
      if (hemap.hasOwnProperty(hash)) {
        var twin = halfedges[hemap[hash]];

        twin.twin = he;
        he.twin = twin;
      }

      // store hashmap entry
      var idx = halfedges.length;
      hemap[tupleHash(i, j)] = idx;

      // store halfedge
      halfedges.push(he);

      he.face = face;

      return he;
    }*/

    function tupleHash(i, j) { return i+"_"+j; }
  }

  // extract groups of connected faces that satisfy the given criterion
  HDS.prototype.groupIntoIslands = function(valid) {
    if (valid===undefined) valid = function() { return true; }

    var faces = this.faces;
    var vs = this.vs;
    var nf = faces.length;

    var seen = new Array(nf);
    seen.fill(false);

    var islands = [];

    // go over every face
    for (var f = 0; f < nf; f++) {
      if (seen[f]) continue;

      var fstart = faces[f];

      // if face is valid, perform a DFS for all reachable valid faces
      if (valid(fstart)) {
        var island = search(fstart);

        if (island.count > 0) islands.push(island);
      }
      else seen[f] = true;
    }

    return islands;

    // does the depth-first search
    function search(fstart) {
      var island = new HDSFaceArray(vs);

      var faceStack = [];

      faceStack.push(fstart);
      while (faceStack.length > 0) {
        var face = faceStack.pop();

        if (seen[face.id]) continue;
        seen[face.id] = true;

        if (valid(face)) {
          island.addFace(face);

          var hestart = face.halfedge;
          var he = hestart;
          do {
            if (he.twin) {
              var neighbor = he.twin.face;
              if (neighbor) faceStack.push(neighbor);
            }
            he = he.next;
          } while (he != hestart);
        }
      }

      return island;
    }
  }

  HDS.prototype.filterFaces = function(valid) {
    var faces = this.faces;
    var nf = faces.length;

    var result = new HDSFaceArray(this.vs);

    for (var f = 0; f < nf; f++) {
      var face = faces[f];
      if (valid(face)) result.addFace(face);
    }

    return result;
  }



  return HDS;

})();
