/*
   BMesh data structrure. Concept (but not implementation) borrowed from
   https://en.blender.org/index.php/Dev:Source/Modeling/BMesh/Design

   This structure is completely general and can represent non-manifold meshes,
   n-gons, wire edges, and isolated vertices.
*/

var BMesh = (function() {

  var BMeshArrayReallocateRatio = 0.6;

  // utility for checking element uniqueness
  function tupleHash(i, j) { return i + "_" + j; }



  // BMesh vertex
  // a single point in the BMesh
  //
  // arguments:
  //  v: a 3-vector supporting the same API as THREE.Vector3
  //  edge: some BMEdge that contains this vert
  function BMVert(v) {
    this.id = -1;

    this.flags = BMesh.Flags.none;

    this.v = v;
    this.edge = null;

    this.nedges = 0;
  }

  Object.assign(BMVert.prototype, {
    // returns an iterator over the vert's disk cycle
    diskIterator: function() {
      if (!this.edge) return null;

      return new DiskIterator(this);
    },

    setFlag: function(flag) {
      this.flags |= flag;
    },

    unsetFlag: function(flag) {
      this.flags &= ~flag;
    },

    hasFlag: function(flag) {
      return !!(this.flags & flag);
    },

    destroyed: function() {
      return this.hasFlag(BMesh.Flags.destroyed);
    },

    isolated: function() {
      return this.edge === null;
    },

    addEdgeToDiskCycle: function(edge) {
      this.nedges++;

      if (this.edge === null) {
        this.edge = edge;

        return;
      }

      // get the edge and disk node for this vertex
      var thisedge = this.edge;
      var thisdisk = thisedge.getVertDisk(this);

      // get the next disk node
      var nextedge = thisdisk.next;
      var nextdisk = nextedge.getVertDisk(this);

      // get edge disk node to add
      var edgedisk = edge.getVertDisk(this);

      // todo: maybe check if edge is already present?

      // insert new disk node after current node
      thisdisk.next = edge;
      edgedisk.prev = thisedge;
      nextdisk.prev = edge;
      edgedisk.next = nextedge;
    },

    removeEdgeFromDiskCycle: function(edge) {
      var disk = edge.getVertDisk(this);

      // if only one edge attached to the vert, just remove the reference
      if (disk.next === edge) {
        this.edge = null;
      }
      // else, link prev to next in the disk cycle and redirect the edge
      // reference if necessary
      else {
        var nextedge = disk.next;
        var nextdisk = nextedge.getVertDisk(this);

        var prevedge = disk.prev;
        var prevdisk = disk.prev.getVertDisk(this);

        prevdisk.next = nextedge;
        nextdisk.prev = prevedge;

        // vert points to the edge we're removing, so arbitrarily point the
        // reference to the next edge
        if (this.edge === edge) this.edge = nextedge;
      }

      this.nedges--;
    },

    getDisk: function() {
      return this.edge.getVertDisk(this);
    },

    findEdgeWithOtherEndpointInDisk: function(other) {
      var iter = this.diskIterator();

      if (!iter) return null;

      do {
        var edge = iter.val();

        if (edge.v1 === this && edge.v2 === other) return edge;
        if (edge.v2 === this && edge.v1 === other) return edge;
      } while (iter.next() !== iter.start());

      return null;
    }
  });

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
    this.id = -1;

    this.flags = BMesh.Flags.none;

    this.v1 = v1;
    this.v2 = v2;

    this.radial = null;
    this.v1disk = new BMDisk(this);
    this.v2disk = new BMDisk(this);

    this.nfaces = 0;
  }

  Object.assign(BMEdge.prototype, {
    // returns an iterator over the edge's radial cycle
    radialIterator: function() {
      if (!this.radial) return null;

      return new RadialIterator(this);
    },

    setFlag: function(flag) {
      this.flags |= flag;
    },

    unsetFlag: function(flag) {
      this.flags &= ~flag;
    },

    hasFlag: function(flag) {
      return !!(this.flags & flag);
    },

    destroyed: function() {
      return this.hasFlag(BMesh.Flags.destroyed);
    },

    wire: function() {
      return this.radial === null;
    },

    // get the disk cycle corresponding to the vert
    getVertDisk: function(vert) {
      if (this.v1 === vert) return this.v1disk;
      if (this.v2 === vert) return this.v2disk;

      return null;
    },

    // add a face to the radial cycle
    addFaceToRadialCycle: function(face) {
      var node = new BMLoop(this.v1, this, face);

      // if wire edge, init the radial cycle
      if (!this.radial) {
        this.radial = node;
      }
      // else, insert the new node after the radial cycle's root node
      else {
        this.radial.insertAfter(node);
      }

      this.nfaces++;
    },

    removeFaceFromRadialCycle: function(face) {
      var riter = this.radialIterator(), faceloop = null;

      // if no iterator, return
      if (riter === null) return;

      // find the BMLoop with the given face
      do {
        var loop = riter.val();

        if (loop.face === face) {
          faceloop = loop;
          break;
        }
      } while (riter.next() !== riter.start());

      // if failed to find BMLoop with the face, return
      if (faceloop === null) return;

      // if only one node in the radial cycle, just destroy the cycle
      if (faceloop.next === faceloop) {
        this.radial = null;
      }
      // else, if radial cycle points to the node we're removing, move the
      // radial cycle's start to the next node
      else if (this.radial === faceloop) {
        this.radial = faceloop.next;
      }

      // remove the BMLoop from the cycle
      faceloop.removeFromCycle();

      this.nfaces--;
    },

    // returns a THREE.Vector3 pointing along this edge
    edgeVector: function() {
      return this.v2.v.clone().sub(this.v1.v).normalize();
    }
  });

  // BMesh face
  // one face, possibly an n-gon
  function BMFace(verts, edges) {
    this.id = -1;

    this.flags = BMesh.Flags.none;

    // make the loop cycle
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

    // set loop cycle
    this.loop = start;

    this.normal = new THREE.Vector3();

    // compute normal by Newell's method:
    // https://www.khronos.org/opengl/wiki/Calculating_a_Surface_Normal
    if (n > 2) {
      for (var i = 0, j = 1; i < n; i++, j++) {
        if (j === n) j = 0;

        var vi = verts[i].v;
        var vj = verts[j].v;

        this.normal.x += (vi.y - vj.y) * (vi.z + vj.z);
        this.normal.y += (vi.z - vj.z) * (vi.x + vj.x);
        this.normal.z += (vi.x - vj.x) * (vi.y + vj.y);
      }

      this.normal.normalize();
    }

    this.nverts = n;
  }

  // make the circular doubly linked list of BMLoops around the face
  Object.assign(BMFace.prototype, {
    // returns an iterator over the face's loop cycle
    loopIterator: function() {
      if (!this.loop) return null;

      return new LoopIterator(this);
    },

    setFlag: function(flag) {
      this.flags |= flag;
    },

    unsetFlag: function(flag) {
      this.flags &= ~flag;
    },

    hasFlag: function(flag) {
      return !!(this.flags & flag);
    },

    destroyed: function() {
      return this.hasFlag(BMesh.Flags.destroyed);
    },

    // flip face orientation by reversing its loop cycle
    flip: function() {
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

      if (this.normal) this.normal.negate();
    },

    // find the loop cycle node corresponding to the edge
    findLoopCycleNodeWithEdge: function(edge) {
      var iter = this.loopIterator();

      do {
        var loop = iter.val();

        if (loop.edge === edge) return loop;
      } while (iter.next() !== iter.start());

      return null;
    },

    // return true if face's verts agree with the edge's .v1 and .v2; if it's
    // the opposite, return false
    windsForwardAlongEdge: function(edge) {
      var loop = this.findLoopCycleNodeWithEdge(edge);

      return loop.v1 === edge.v1 && loop.v2 === edge.v2;
    },

    // return true if the other face's orientation (given the common edge) is
    // consistent with this face's orientation
    orientationConsistent: function(other, edge) {
      var thisforward = this.windsForwardAlongEdge(edge);
      var otherforward = other.windsForwardAlongEdge(edge);

      // return true if one face is wound forward along the edge but the other
      // is not
      return thisforward !== otherforward;
    }
  });

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

  Object.assign(BMLoop.prototype, {
    // insert another BMLoop node after this node
    insertAfter: function(loop) {
      var next = this.next;

      this.next = loop;
      loop.prev = this;
      loop.next = next;
      next.prev = loop;
    },

    // link the BMLoop node's neighbors to each other, thus removing this node
    // from the circular list
    removeFromCycle: function() {
      this.next.prev = this.prev;
      this.prev.next = this.next;

      this.next = this;
      this.prev = this;
    }
  });



  // BMesh constructor
  function BMesh() {
    this.verts = [];
    this.faces = [];
    this.edges = [];

    this.nverts = 0;
    this.nedges = 0;
    this.nfaces = 0;
  }

  BMesh.Flags = {
    none: 0,
    destroyed: 1,
    inside: 2,
    outside: 4,
  };

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
      vert.id = this.nverts;

      if (vertmap) vertmap[hash] = vert;

      this.verts.push(vert);
      this.nverts++;

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
      edge.id = this.nedges;

      this.edges.push(edge);
      this.nedges++;

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

      var face = new BMFace(verts, edges);
      face.id = this.nfaces;

      // add face to each edge's radial cycle
      for (var e = 0; e < n; e++) {
        edges[e].addFaceToRadialCycle(face);
      }

      this.faces.push(face);
      this.nfaces++;

      return face;
    },

    // destroy any edges incident to the vert and the vert itself; if cleanup,
    // destroying the edges destroys the vert itself, else destroy the vert
    // manually
    destroyVert: function(vert, cleanup) {
      if (vert.destroyed()) return;

      // destroy all incident edges; can't use iterator pattern b/c iterators
      // become invalid when the cycle mutates
      while (vert.edge !== null) {
        var edgenext = vert.edge.getVertDisk(vert).next;

        this.destroyEdge(vert.edge, cleanup);
      }

      this.destroyVertFinal(vert);
    },

    // destroy an edge and any faces incident to it
    destroyEdge: function(edge, cleanup) {
      if (edge.destroyed()) return;

      // destroy all incident faces; can't use iterator pattern b/c iterators
      // become invalid when the cycle mutates
      while (edge.radial !== null) {
        var loopnext = edge.radial.next;

        this.destroyFace(edge.radial.face, cleanup);
      }

      // if destroying the faces cleaned up this edge already, just exit here
      if (edge.destroyed()) return;

      // remove the edge from its verts' disk cycles
      edge.v1.removeEdgeFromDiskCycle(edge);
      edge.v2.removeEdgeFromDiskCycle(edge);

      // if cleanup and either vert ends up isolated, destroy it
      if (cleanup) {
        if (edge.v1.isolated()) this.destroyVertFinal(edge.v1);
        if (edge.v2.isolated()) this.destroyVertFinal(edge.v2);
      }

      this.destroyEdgeFinal(edge);
    },

    // if cleanup, destroy any elements that end up disconnected after removing
    // this face (wire edges and/or isolated verts)
    destroyFace: function(face, cleanup) {
      if (face.destroyed()) return;

      // remove face from all adjacent edges
      var iter = face.loopIterator();

      do {
        var edge = iter.val().edge;

        // erase the edge's adjacency to the face
        edge.removeFaceFromRadialCycle(face);

        // if cleaning up and edge became isolated after removing this face,
        // destroy the edge
        if (cleanup && edge.wire()) this.destroyEdge(edge);
      } while (iter.next() !== iter.start());

      // if cleaning up, remove any resulting isolated verts
      if (cleanup) {
        do {
          var vert = iter.val().vert;

          if (vert.isolated()) this.destroyVert(vert);
        } while (iter.next() !== iter.start());
      }

      this.destroyFaceFinal(face);
    },

    // handle final vert invalidation
    destroyVertFinal: function(vert) {
      if (vert.destroyed()) return;

      // set the vert as destroyed, fully remove it later
      vert.setFlag(BMesh.Flags.destroyed);

      // decrement verts
      this.nverts--;

      this.updateVertArray();
    },

    // handle final edge invalidation
    destroyEdgeFinal: function(edge) {
      if (edge.destroyed()) return;

      // set the edge as destroyed, fully remove it later
      edge.setFlag(BMesh.Flags.destroyed);

      // decrement edges
      this.nedges--;

      this.updateEdgeArray();
    },

    // handle final face invalidation
    destroyFaceFinal: function(face) {
      if (face.destroyed()) return;

      // set the face as destroyed, fully remove it later
      face.setFlag(BMesh.Flags.destroyed);

      // decrement faces
      this.nfaces--;

      // remove the loop cycle
      face.loop = null;

      this.updateFaceArray();
    },

    // if one of the underlying arrays (verts/edges/faces) is more than
    // BMeshArrayReallocateRatio full of destroyed elements, reallocate
    updateArrays: function() {
      // verts
      this.updateVertArray();

      // edges
      this.updateEdgeArray();

      // faces
      this.updateFaceArray();
    },

    // reallocate vert array if necessary
    updateVertArray: function() {
      var vlen = this.verts.length;

      if (vlen > 0 && (this.nverts / vlen) > BMeshArrayReallocateRatio) {
        this.verts = this.reallocateArray(this.verts, this.nverts);
      }
    },

    // reallocate edge array if necessary
    updateEdgeArray: function() {
      var elen = this.edges.length;

      if (elen > 0 && (this.nedges / elen) > BMeshArrayReallocateRatio) {
        this.edges = this.reallocateArray(this.edges, this.nedges);
      }
    },

    // reallocate face array if necessary
    updateFaceArray: function() {
      var flen = this.faces.length;

      if (flen > 0 && (this.nfaces / flen) > BMeshArrayReallocateRatio) {
        this.faces = this.reallocateArray(this.faces, this.nfaces);
      }
    },

    // reallocate an array - only keep the non-destroyed elements
    reallocateArray: function(arr, n) {
      var result = new Array(n);
      var destroyed = BMesh.Flags.destroyed;

      for (var i = 0, j = 0, l = arr.length; i < l; i++) {
        var element = arr[i];

        if (!element.destroyed()) {
          result[j] = element;
          j++;
        }
      }

      return result;
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

      // todo: remove
      console.log("verts", this.verts.length);
      console.log("edges", this.edges.length);
      console.log("faces", this.faces.length);

      return this;
    },

    toGeometry: function() {
      var geo = new THREE.Geometry();

      this.forEachFace(function(face) {
        var n = geo.vertices.length;

        var iter = face.loopIterator();

        do {
          var loop = iter.val();
          geo.vertices.push(loop.vert.v);
        } while (iter.next() !== iter.start());

        var face3 = new THREE.Face3(n, n + 1, n + 2);
        face3.normal.copy(face.normal);

        geo.faces.push(face3);
      });

      return geo;
    },

    forEachVert: function(callback) {
      for (var v = 0, l = this.verts.length; v < l; v++) {
        var vert = this.verts[v];

        if (!vert.destroyed()) callback(vert);
      }
    },

    forEachEdge: function(callback) {
      for (var e = 0, l = this.edges.length; e < l; e++) {
        var edge = this.edges[e];

        if (!edge.destroyed()) callback(edge);
      }
    },

    forEachFace: function(callback) {
      for (var f = 0, l = this.faces.length; f < l; f++) {
        var face = this.faces[f];

        if (!face.destroyed()) callback(face);
      }
    },



    // debugging functions
    // todo: remove
    debugVerts: function(matrix) {
      debug.cleanup();

      var _this = this;
      this.forEachVert(function(vert) {
        _this.debugVert(vert, matrix, true);
      });

      debug.lines();
    },

    debugVert: function(vert, matrix, group) {
      if (!group) debug.cleanup();

      var iter = vert.diskIterator();

      var total = new THREE.Vector3();
      var v1 = vert.v.clone().applyMatrix4(matrix);
      var ct = 0;

      do {
        ct++;
        var edge = iter.val();

        var other = edge.v1 === vert ? edge.v2 : edge.v1;
        var v2 = other.v.clone().applyMatrix4(matrix);
        var d = v2.clone().sub(v1);
        var dist = d.length();
        d.normalize();

        total.add(d);

        debug.line(v1, v1.clone().addScaledVector(d, dist/4));
      } while (iter.next() !== iter.start());

      debug.line(v1, v1.clone().add(total.negate().setLength(0.1 * ct)));

      if (!group) debug.lines();
    },

    debugEdges: function(matrix) {
      debug.cleanup();

      var _this = this;
      this.forEachEdge(function(edge) {
        _this.debugEdge(edge, matrix, true);
      });

      debug.lines();
    },

    debugEdge: function(edge, matrix, group) {
      if (!group) debug.cleanup();

      debug.line(edge.v1.v.clone().applyMatrix4(matrix), edge.v2.v.clone().applyMatrix4(matrix));

      var ecenter = edge.v1.v.clone().add(edge.v2.v).multiplyScalar(0.5).applyMatrix4(matrix);

      var riter = edge.radialIterator();

      if (!riter) {
        return;
      }

      do {
        var face = riter.val().face;

        if (face.destroyed()) {
          continue;
        }

        var fcenter = new THREE.Vector3();
        var vnum = 0;

        var fiter = face.loopIterator();

        do {
          fcenter.add(fiter.val().vert.v);
          vnum++;
        } while (fiter.next() !== fiter.start());

        fcenter.divideScalar(vnum).applyMatrix4(matrix);

        var d = fcenter.clone().sub(ecenter);
        var dist = d.length();
        d.normalize();

        debug.line(ecenter, ecenter.clone().addScaledVector(d, dist/4));
      } while (riter.next() !== riter.start());

      if (!group) debug.lines();
    },

    debugFaces: function(matrix) {
      debug.cleanup();

      var _this = this;
      this.forEachFace(function(face) {
        _this.debugFace(face, matrix, true);
      });

      debug.lines();
    },

    debugFace: function(face, matrix, group) {
      if (!group) debug.cleanup();

      // face center
      var fcenter = new THREE.Vector3();
      var vnum = 0;

      var fiter = face.loopIterator();

      do {
        fcenter.add(fiter.val().vert.v);
        vnum++;
      } while (fiter.next() !== fiter.start());

      fcenter.divideScalar(vnum).applyMatrix4(matrix);

      var iter = face.loopIterator();
      var len = 0;
      var ct = 0;

      do {
        ct++;

        var loop = iter.val();
        var ploop = iter.peekPrev();
        var nloop = iter.peekNext();

        var v = loop.vert.v.clone().applyMatrix4(matrix);
        var pv = ploop.vert.v.clone().applyMatrix4(matrix);
        var nv = nloop.vert.v.clone().applyMatrix4(matrix);

        var dp = pv.clone().sub(v);
        var dn = nv.clone().sub(v);

        len += dn.length();
        dp.normalize();
        dn.normalize();

        var angle = dp.angleTo(dn) / 2;
        var b = dp.add(dn).multiplyScalar(0.5).normalize();

        var dist = v.distanceTo(nv);

        var vnew = v.clone().addScaledVector(b, 0.025 / Math.sin(angle));
        var nvnew = vnew.clone().addScaledVector(dn, dist * 0.75);

        debug.line(vnew, nvnew);
        debug.line(nvnew, nvnew.clone().multiplyScalar(0.8).add(fcenter.clone().multiplyScalar(0.2)));
      } while (iter.next() !== iter.start());

      debug.line(fcenter, fcenter.clone().addScaledVector(face.normal, len * 0.1 / ct));

      if (!group) debug.lines();
    }

  });



  // iterator types

  // intended usage pattern, e.g.,
  //
  // var iter = edge.radialIterator();
  //
  // do {
  //   loop = iter.val(); // BMLoop
  // } while (iter.next() !== iter.start());

  // base type
  function Iterator(source) {
    this._source = source;
    this._val = null;
    this._start = null;
  }

  Object.assign(Iterator.prototype, {
    constructor: Iterator,

    val: function() {
      return this._val;
    },

    start: function() {
      return this._start;
    },

    next: function() {
      return this._val;
    },

    prev: function() {
      return this._val;
    },

    // peek ahead
    peekNext: function() {
      var val = this.next();

      this.prev();

      return val;
    },

    // peek back
    peekPrev: function() {
      var val = this.prev();

      this.next();

      return val;
    }
  });



  // iterates over a vert's disk cycle
  function DiskIterator(vert) {
    Iterator.call(this, vert);

    this._val = vert.edge;
    this._start = this._val;
  }

  DiskIterator.prototype = Object.create(Iterator.prototype);
  Object.assign(DiskIterator.prototype, {
    constructor: DiskIterator,

    // go to the next edge in the disk
    next: function() {
      if (!this._val) return null;

      this._val = this._val.getVertDisk(this._source).next;

      return this._val;
    },

    // go to the previous edge in the disk
    prev: function() {
      if (!this._val) return null;

      this._val = this._val.getVertDisk(this._source).prev;

      return this._val;
    }
  });



  // iterates over the BMLoops in a face's loop cycle
  function LoopIterator(face) {
    Iterator.call(this, face);

    this._val = face.loop;
    this._start = this._val;
  }

  LoopIterator.prototype = Object.create(Iterator.prototype);
  Object.assign(LoopIterator.prototype, {
    constructor: LoopIterator,

    // go to the next loop in the cycle
    next: function() {
      if (!this._val) return null;

      this._val = this._val.next;

      return this._val;
    },

    // go to the previous loop in the cycle
    prev: function() {
      if (!this._val) return null;

      this._val = this._val.prev;

      return this._val;
    }
  });



  // iterates over the BMLoops in an edge's radial cycle
  function RadialIterator(edge) {
    Iterator.call(this, edge);

    this._val = edge.radial;
    this._start = this._val;
  }

  // member functions are the same as those of LoopIterator
  RadialIterator.prototype = Object.create(LoopIterator.prototype);
  Object.assign(RadialIterator.prototype, {
    constructor: RadialIterator
  });



  return BMesh;

}());
