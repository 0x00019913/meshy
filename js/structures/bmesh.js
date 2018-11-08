/*
   BMesh data structrure. Concept (but not implementation) borrowed from
   https://en.blender.org/index.php/Dev:Source/Modeling/BMesh/Design

   This structure is completely general and can represent non-manifold meshes,
   n-gons, wire edges, and isolated vertices.
*/

var BMesh = (function() {

  var BMeshFlags = {
    none: 0,
    inside: 1,
    outside: 2
  };

  // utility for checking element uniqueness
  function tupleHash(i, j) { return i + "_" + j; }

  // BMesh vertex
  // a single point in the BMesh
  //
  // arguments:
  //  v: a 3-vector supporting the same API as THREE.Vector3
  //  edge: some BMEdge that contains this vert
  function BMVert(v, edge) {
    this.v = v || null;
    this.edge = edge || null;
  }

  BMVert.prototype.addEdgeToDiskCycle = function(newedge) {
    if (this.edge === null) {
      this.edge = newedge;

      return;
    }

    // get the edge and disk node for this vertex
    var thisedge = this.edge;
    var thisdisk = thisedge.getVertDisk(this);

    // get the next disk node
    var nextedge = thisdisk.next;
    var nextdisk = nextedge.getVertDisk(this);

    // get edge disk node to add
    var newedgedisk = newedge.getVertDisk(this);

    // todo: maybe check if edge is already present?

    // insert new disk node after current node
    thisdisk.next = newedge;
    newedgedisk.prev = thisedge;
    nextdisk.prev = newedge;
    newedgedisk.next = nextedge;
  }

  BMVert.prototype.getDisk = function() {
    return this.edge.getVertDisk(this);
  }

  BMVert.prototype.findEdgeWithOtherEndpointInDisk = function(other) {
    var start = this.edge;

    if (start === null) return null;

    var curr = start;
    do {
      if (curr.v1 === this && curr.v2 === other) return curr;
      if (curr.v2 === this && curr.v1 === other) return curr;

      curr = curr.getVertDisk(this).next;
    } while (curr !== start);

    return null;
  }

  // node in a disk cycle (doubly linked circular list) of edges around a vert;
  // two of these exist per edge
  function BMDisk(edge) {
    this.prev = edge || null;
    this.next = edge || null;
  }

  // BMesh edge
  // has two endpoints, a radial cycle containing the incident faces, and two
  // disk cycles for each endpoint
  //
  // arguments:
  //  v1, v2: pair of BMVerts signifying the endpoints, in no particular order
  function BMEdge(v1, v2) {
    this.v1 = v1 || null;
    this.v2 = v2 || null;

    this.radial = new BMLoop(this);
    this.v1disk = new BMDisk(this);
    this.v2disk = new BMDisk(this);
  }

  // get the disk cycle corresponding to the vert
  BMEdge.prototype.getVertDisk = function(vert) {
    if (this.v1 === vert) return this.v1disk;
    if (this.v2 === vert) return this.v2disk;

    return null;
  }

  // add a face to the radial cycle
  BMEdge.prototype.addFaceToRadialCycle = function(face) {
    var node = new BMLoop(this.v1, this, face);

    // insert the new node after the radial cycle's root node
    this.radial.insertAfter(node);
  }

  // BMesh face
  // one face, possibly an n-gon
  function BMFace() {
    this.id = -1;

    this.normal = null;
    this.loop = null;
  }

  // make the circular doubly linked list of BMLoops around the face
  BMFace.prototype.makeLoopCycle = function(verts, edges) {
    var n = verts.length;
    var prev = null, start = null;

    for (var i = 0; i < n; i++) {
      var vert = verts[i];
      var edge = edges[i];

      var node = new BMLoop(vert, edge, this);

      // if no start, record first node
      if (start === null) start = node;
      // else, link current node to prev node
      else {
        prev.next = node;
        node.prev = prev;
      }

      prev = node;
    }

    // link start and end
    prev.next = start;
    start.prev = prev;

    this.loop = start;
  }

  // flip face orientation by reversing its loop cycle
  BMFace.prototype.flip = function() {
    var start = this.loop;
    var node = start;

    // go forward along each node's original .next pointer, flipping the .next
    // and .prev pointers
    do {
      var tmp = node.next;
      node.next = node.prev;
      node.prev = tmp;

      // go to node's original .next
      node = tmp;
    } while (node !== start);
  }

  // BMesh loop
  //
  // arguments:
  //  edge: BMEdge on which this loop is incident
  //  face: BMFace with which this loop is associated (one face of the radial
  //   fan if radial cycle, else the same face as its neighbors for loop cycle)
  function BMLoop(vert, edge, face) {
    this.edge = edge || null;
    this.vert = vert || null;
    this.face = face || null;

    this.next = this;
    this.prev = this;
  }

  // insert another BMLoop node after this node
  BMLoop.prototype.insertAfter = function(loop) {
    var next = this.next;

   this.next = loop;
   loop.prev = this;
   loop.next = next;
   next.prev = loop;
  }



  function BMesh() {
    this.verts = [];
    this.faces = [];
    this.edges = [];
  }

  Object.assign(BMesh.prototype, {

    constructor: BMesh,

    createVert: function(v, vertmap, p) {
      var hash;

      // if given a map to check vert uniqueness, use it to retrieve the vert
      // (if it exists)
      if (vertmap) {
        hash = Compute.vectorHash(v, p);

        if (vertmap.hasOwnProperty(hash)) return vertmap[hash];
      }

      var vert = new BMVert(v.clone());

      if (vertmap) vertmap[hash] = vert;

      this.verts.push(vert);

      return vert;
    },

    createEdge: function(bmv1, bmv2, unique) {
      if (bmv1 === bmv2) return null;

      var edge;

      // if edge must be unique, check bmv1's disk cycle for an edge with both
      // endpoints
      if (unique) {
        edge = bmv1.findEdgeWithOtherEndpointInDisk(bmv2);

        if (edge) return edge;
      }

      edge = new BMEdge(bmv1, bmv2);

      this.edges.push(edge);

      bmv1.addEdgeToDiskCycle(edge);
      bmv2.addEdgeToDiskCycle(edge);

      return edge;
    },

    createFace: function(verts, edges, unique) {
      var n = verts.length;

      // todo: if unique, check if duplicate face exists
      if (unique) {

      }

      // same number of verts and edges
      if (n !== edges.length) return;

      var face = new BMFace();

      // add face to each edge's radial cycle
      for (var e = 0; e < n; e++) {
        edges[e].addFaceToRadialCycle(face);
      }

      face.makeLoopCycle(verts, edges);

      this.faces.push(face);

      return face;
    },

    fromGeometry: function(geometry, p) {
      // precision factor
      p = p || 1e5;

      // used to determine unique verts
      var vertmap = {};

      var verts = this.verts;
      var faces = this.faces;
      var edges = this.edges;

      var createVert = this.createVert.bind(this);
      var createEdge = this.createEdge.bind(this);
      var createFace = this.createFace.bind(this);

      Compute.traverseFaces(geometry, function(va, vb, vc) {
        // 3 BMesh verts
        var bmva = createVert(va, vertmap, p);
        var bmvb = createVert(vb, vertmap, p);
        var bmvc = createVert(vc, vertmap, p);

        // 3 BMesh edges
        var bmeab = createEdge(bmva, bmvb, true);
        var bmebc = createEdge(bmvb, bmvc, true);
        var bmeca = createEdge(bmvc, bmva, true);

        var face = createFace([bmva, bmvb, bmvc], [bmeab, bmebc, bmeca]);
      });

      return this;
    },

    toGeometry: function() {
      var geo = new THREE.Geometry();

      for (var f = 0, l = this.faces.length; f < l; f++) {
        var face = this.faces[f];
        var loop = face.loop, curr = loop;

        do {
          geo.vertices.push(curr.vert.v);

          curr = curr.next;
        } while (curr !== loop);

        var n = geo.vertices.length;

        geo.faces.push(new THREE.Face3(n, n + 1, n + 2));
      }

      return geo;
    },

    debugVert: function(idx, matrix) {
      var vert = this.verts[idx];

      if (!vert) return;

      debug.cleanup();

      var start = vert.edge;
      var curr = start;

      var total = new THREE.Vector3();

      do {
        var other = curr.v1 === vert ? curr.v2 : curr.v1;
        console.log(vert, other);

        var v1 = vert.v.clone().applyMatrix4(matrix);
        var v2 = other.v.clone().applyMatrix4(matrix);
        var d = v2.clone().sub(v1);
        var dist = d.length();
        d.normalize();

        total.add(d);

        debug.line(v1, v1.clone().add(d));

        curr = curr.getVertDisk(vert).next;
      } while (curr !== start);

      debug.line(v1, v1.clone().addScaledVector(total, -1));

      debug.lines();
    }

  });



  return BMesh;

}());
