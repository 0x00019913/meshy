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
        var edge = iter.val;

        if (edge.v1 === this && edge.v2 === other) return edge;
        if (edge.v2 === this && edge.v1 === other) return edge;
      } while (iter.next() !== iter.start);

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

    // true if wire edge
    wire: function() {
      return this.nfaces === 0;;
    },

    // true if border edge
    border: function() {
      return this.nfaces === 1;
    },

    // true if regular edge
    regular: function() {
      return this.nfaces === 2;
    },

    // true if singular edge
    singular: function() {
      return this.nfaces > 2;
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
        var loop = riter.val;

        if (loop.face === face) {
          faceloop = loop;
          break;
        }
      } while (riter.next() !== riter.start);

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
    },

    // given one endpoint, return the other
    otherVert: function(vert) {
      return this.v1 === vert ? this.v2 : this.v1;
    },

    // given one endpoint, replace it with a different vert
    replaceVert: function(original, final) {
      var isv1 = this.v1 === original;

      original.removeEdgeFromDiskCycle(this);

      if (isv1) this.v1 = final;
      else this.v2 = final;

      final.addEdgeToDiskCycle(this);
    }
  });

  // BMesh face
  // one face, possibly an n-gon
  function BMFace(loop) {
    this.id = -1;

    this.flags = BMesh.Flags.none;

    // set loop cycle
    this.loop = loop;

    // compute normal and set number of verts
    var normal = new THREE.Vector3(), n = 0;
    var iter = loop.iterator();

    // compute normal by Newell's method:
    // https://www.khronos.org/opengl/wiki/Calculating_a_Surface_Normal
    do {
      var vi = iter.val.vert.v;
      var vj = iter.val.next.vert.v;

      normal.x += (vi.y - vj.y) * (vi.z + vj.z);
      normal.y += (vi.z - vj.z) * (vi.x + vj.x);
      normal.z += (vi.x - vj.x) * (vi.y + vj.y);

      n++;
    } while (iter.next() !== iter.start);

    this.normal = normal.normalize();

    this.nverts = n;
  }

  // make the circular doubly linked list of BMLoops around the face
  Object.assign(BMFace.prototype, {
    // returns an iterator over the face's loop cycle
    loopIterator: function() {
      if (!this.loop) return null;

      return this.loop.iterator();
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

    setVertFlags: function(flag) {
      var iter = this.loopIterator();

      do {
        iter.val.vert.setFlag(flag);
      } while (iter.next() !== iter.start);
    },

    unsetVertFlags: function(flag) {
      var iter = this.loopIterator();

      do {
        iter.val.vert.unsetFlag(flag);
      } while (iter.next() !== iter.start);
    },

    setEdgeFlags: function(flag) {
      var iter = this.loopIterator();

      do {
        iter.val.edge.setFlag(flag);
      } while (iter.next() !== iter.start);
    },

    unsetEdgeFlags: function(flag) {
      var iter = this.loopIterator();

      do {
        iter.val.edge.unsetFlag(flag);
      } while (iter.next() !== iter.start);
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

        // flip edge winding direction
        node.forward = !node.forward;
      } while (node !== start);

      if (this.normal) this.normal.negate();
    },

    // find the loop cycle node corresponding to the edge
    findLoopCycleNodeWithEdge: function(edge) {
      var iter = this.loopIterator();

      do {
        var loop = iter.val;

        if (loop.edge === edge) return loop;
      } while (iter.next() !== iter.start);

      return null;
    },

    // return true if face's verts agree with the edge's .v1 and .v2; if it's
    // the opposite, return false
    windsForwardAlongEdge: function(edge) {
      return this.findLoopCycleNodeWithEdge(edge).forward;
    },

    // return true if the other face's orientation (given the common edge) is
    // consistent with this face's orientation
    orientationConsistent: function(other, edge) {
      var thisforward = this.windsForwardAlongEdge(edge);
      var otherforward = other.windsForwardAlongEdge(edge);

      // return true if one face is wound forward along the edge but the other
      // is not
      return thisforward !== otherforward;
    },

    // gets the other face across the given edge; assumes that this face
    // borders the given edge
    //
    // for a wire/border edge (0/1 faces), returns null
    // for a regular edge (2 faces), returns the other face
    // for a singular edge (3+ faces), return the "upward continuation" of the
    //   face in the polygon fan
    other: function(edge) {
      var nfaces = edge.nfaces;

      // wire or border edge
      if (nfaces < 2) return null;
      else if (nfaces === 2) {
        var radial = edge.radial;

        if (radial.face === this) radial = radial.next;

        return radial.face;
      }
      // todo: upward continuation
      else {

      }
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

    // used in loop cycles: true if edge's .v1 and .v2 agree with the vert
    // order in the loop, else false
    this.forward = false;

    this.next = this;
    this.prev = this;
  }

  Object.assign(BMLoop.prototype, {
    iterator: function() {
      return new LoopIterator(this);
    },

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
    },

    // replace a vert in the loop cycle
    replaceVert: function(original, final) {
      var iter = this.iterator();
      var loop = null;

      do {
        if (iter.val.vert === original) {
          loop = iter.val;
          break;
        }
      } while (iter.next() !== iter.start);

      if (loop) loop.vert = final;
    },

    // replace an edge in the loop cycle
    replaceEdge: function(original, final) {
      var iter = this.iterator();
      var loop = null;

      do {
        if (iter.val.edge === original) {
          loop = iter.val;
          break;
        }
      } while (iter.next() !== iter.start);

      if (loop) loop.edge = final;
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

    this.vertid = 0;
    this.edgeid = 0;
    this.faceid = 0;
  }

  BMesh.Flags = {
    none: 0,
    destroyed: 1<<0,
    visited: 1<<1
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
      vert.id = this.vertid++;

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
      edge.id = this.edgeid++;

      this.edges.push(edge);
      this.nedges++;

      bmv1.addEdgeToDiskCycle(edge);
      bmv2.addEdgeToDiskCycle(edge);

      return edge;
    },

    createLoop: function(verts, edges) {
      // make the loop cycle
      var n = verts.length;

      // same number of verts and edges
      if (n !== edges.length) return null;

      var prev = null, start = null;

      for (var i = 0, j = 1; i < n; i++, j++) {
        if (j === n) j = 0;

        var vi = verts[i];
        var vj = verts[j];
        var edge = edges[i];

        var node = new BMLoop(vi, edge);
        node.forward = edge.v1 === vi;

        // if no start, record first node
        if (start === null) start = node;
        // else, link current node to prev node
        else {
          prev.next = node;
          node.prev = prev;
        }

        prev = node;
      }

      // link the start and end
      prev.next = start;
      start.prev = prev;

      return start;
    },

    createFace: function(loop, unique) {
      var face = new BMFace(loop);

      // if unique, check if a duplicate face exists: take an edge in the loop,
      // iterate over the faces in its radial cycle, check if any of them have
      // an equivalent loop (forward or backward)
      if (unique) {
        var edge = loop.edge;
        var riter = edge.radialIterator();

        if (riter) {
          do {
            var otherface = riter.val.face;

            // different n-gon, won't be a duplicate
            if (otherface.nverts !== face.nverts) continue;

            var otherloop = otherface.loop;

            // find starting point that matches the current loop
            while (otherloop.edge !== edge) otherloop = otherloop.next;

            // true if going in the same direction along both loops
            var windSameDirection = loop.forward === otherloop.forward;

            // go through both loops simultaneously, break on any mismatching
            // edges
            var liter = loop, oliter = otherloop;

            do {
              if (liter.edge !== oliter.edge) break;

              liter = liter.next;
              oliter = windSameDirection ? oliter.next : oliter.prev;
            } while (oliter !== otherloop);

            // if we made it all the way through without finding a mismatched
            // edge, the face is a duplicate
            if (oliter === otherloop) return null;
          } while (riter.next() !== riter.start);
        }
      }

      // all clear, so proceed to increment id, etc.
      face.id = this.faceid++;

      // add the face to each edge's radial cycle
      var iter = loop;

      do {
        iter.face = face;
        iter.edge.addFaceToRadialCycle(face);

        iter = iter.next;
      } while (iter !== loop);

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
        var edge = iter.val.edge;

        // erase the edge's adjacency to the face
        edge.removeFaceFromRadialCycle(face);

        // if cleaning up and edge became isolated after removing this face,
        // destroy the edge
        if (cleanup && edge.wire()) this.destroyEdge(edge);
      } while (iter.next() !== iter.start);

      // if cleaning up, remove any resulting isolated verts
      if (cleanup) {
        do {
          var vert = iter.val.vert;

          if (vert.isolated()) this.destroyVert(vert);
        } while (iter.next() !== iter.start);
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

    // set a flag on all verts
    setVertFlags: function(flag) {
      this.forEachVert(function(vert) {
        vert.setFlag(flag);
      });
    },

    // unset a flag on all verts
    unsetVertFlags: function(flag) {
      this.forEachVert(function(vert) {
        vert.unsetFlag(flag);
      });
    },

    // set a flag on all edges
    setEdgeFlags: function(flag) {
      this.forEachEdge(function(edge) {
        edge.setFlag(flag);
      });
    },

    // unset a flag on all edges
    unsetEdgeFlags: function(flag) {
      this.forEachEdge(function(edge) {
        edge.unsetFlag(flag);
      });
    },

    // set a flag on all faces
    setFaceFlags: function(flag) {
      this.forEachFace(function(face) {
        face.setFlag(flag);
      });
    },

    // unset a flag on all faces
    unsetFaceFlags: function(flag) {
      this.forEachFace(function(face) {
        face.unsetFlag(flag);
      });
    },

    detachSingularEdges: function() {
      // id-to-vert hash map of endpoints of singular edges
      var singularEdgeEndpoints = {};

      this.forEachEdge(function(edge) {
        if (edge.singular()) {
          var v1 = edge.v1;
          var v2 = edge.v2;

          singularEdgeEndpoints[v1.id] = v1;
          singularEdgeEndpoints[v2.id] = v2;
        }
      });

      // for each vert, build an array of chains of edges such that 1. all
      // edges are incident on the vert, 2. consecutive pairs of edges share a
      // face, and 3. each chain begins and ends on singular/border edges; in
      // effect, each chain represents a discrete fan of faces incident on the
      // vert

      for (var vertid in singularEdgeEndpoints) {
        var vert = singularEdgeEndpoints[vertid];

        // faces seen so far
        var facesSeen = {};

        // chains of edges
        var chains = [];

        var diter = vert.diskIterator();

        if (!diter) continue;

        // go through all edges in the vert's disk cycle and build the edge
        // chains
        do {
          var edge = diter.val;

          // if singular or border edge, one or more chains start here; build
          // all chains emanating from here
          if (!edge.regular()) {
            getEdgeChainsFromEdge(vert, edge, facesSeen, chains);
          }
        } while (diter.next() !== diter.start);

        // detach the vert: for all but one of the edge chains,
        // 1. create a duplicate vert,
        // 2. duplicate first and last chain edge (but only if singular),
        //   attaching one end to the duplicate and the other to the original
        //   other vert,
        // 3. replace the original start/end edges in the start/end faces of
        //   the chain with their duplicates,
        // 4. remove the start/end faces of the chain from the original
        //   start/end edges' radial cycles,
        //
        // so, in the end, every chain of faces terminates with a border edge

        for (var ci = 0, cl = chains.length; ci < cl; ci++) {
          var chain = chains[ci];

          var edges = chain.edges, faces = chain.faces;
          var elen = edges.length, flen = faces.length;

          // don't need to detach anything if chain starts and ends in border
          // edges
          if (edges[0].border() && edges[elen - 1].border()) continue;

          // if start and end edges are the same edge, just leave it as a
          // connected disk
          if (edges[0] === edges[elen - 1]) continue;

          // duplicate vert
          var vertclone = this.createVert(vert.v);

          for (var ei = 0; ei < elen; ei++) {
            var edge = edges[ei];

            // move edge to new vert's disk cycle

            // if first edge and not a border edge, duplicate it and assign the
            // first face to the duplicate
            if (ei === 0 && !edge.border()) {
              var edgeclone = this.createEdge(vertclone, edge.other(vert));
              var face = faces[0];

              edge.removeFaceFromRadialCycle(face);
              edgeclone.addFaceToRadialCycle(face);

              vert.removeEdgeFromDiskCycle(edge);
              verclone.addEdgeToDiskCycle(edgeclone);
            }
            // ditto for last edge
            else if (ei === (elen - 1) && !edge.border()) {
              var edgeclone = this.createEdge(vertclone, edge.other(vert));
              var face = faces[flen - 1];

              edge.removeFaceFromRadialCycle(face);
              edgeclone.addFaceToRadialCycle(face);

              vert.removeEdgeFromDiskCycle(edge);
              verclone.addEdgeToDiskCycle(edgeclone);
            }
            // else, if intermediate edge, just replace the endpoint with the
            // duplicate vert
            else {
              edge.replaceVert(vert, vertclone);
            }
          }
        }
      }

      // args:
      //  vert: current vertex on which all edges and faces are incident
      //  edge: current border/singular edge from which chains emanate
      //  facesSeen: record of faces seen so far, prevents duplicate chains
      //  chains: output array
      function getEdgeChainsFromEdge(vert, edge, facesSeen, chains) {
        var riter = edge.radialIterator();

        if (!riter) return;

        do {
          var face = riter.val.face;

          getEdgeChainFromFace(vert, edge, face, facesSeen, chains);
        } while (riter.next() !== riter.start);
      }

      // args:
      //  vert: current vertex on which all edges and faces are incident
      //  edge: current border/singular edge from which chains emanate
      //  face: start face of a chain
      //  facesSeen: record of faces seen so far, prevents duplicate chains
      //  chains: output array
      function getEdgeChainFromFace(vert, edge, face, facesSeen, chains) {
        // face already included in a chain, so do nothing
        if (facesSeen.hasOwnProperty(face.id)) return;

        // stores edge chain
        var chain = {
          edges: [edge],
          faces: []
        };

        var edgeprev = null;

        // go through a chain of faces incident on the vert until we hit
        // a border/singular edge
        do {
          facesSeen[face.id] = face;

          edgeprev = edge;

          // find another edge on the face that's incident on the vert
          var liter = face.loopIterator();

          do {
            var loopedge = liter.val.edge;

            if (loopedge !== edge && (loopedge.v1 === vert || loopedge.v2 === vert)) {
              edge = loopedge;
              break;
            }
          } while (liter.next() !== liter.start);

          // if face doesn't have a second edge touching the vert, ignore it
          if (edge === edgeprev) return;

          // store the edge and face
          chain.edges.push(edge);
          chain.faces.push(face);

          // end the chain if we hit a border/singular edge
          if (!edge.regular()) break;

          // get the next face
          face = face.other(edge);
        } while (edge.regular());

        chains.push(chain);
      }
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
      var createLoop = this.createLoop.bind(this);
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

        // if edge creation failed (two verts coincident), do nothing
        if (!bmeab || !bmebc || !bmeca) return;

        var loop = createLoop([bmva, bmvb, bmvc], [bmeab, bmebc, bmeca]);

        var face = createFace(loop, true);
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
          var loop = iter.val;
          geo.vertices.push(loop.vert.v);
        } while (iter.next() !== iter.start);

        var face3 = new THREE.Face3(n, n + 1, n + 2);
        face3.normal.copy(face.normal);

        geo.faces.push(face3);
      });

      return geo;
    },

    forEachVert: function(callback) {
      for (var v = 0, l = this.verts.length; v < l; v++) {
        var vert = this.verts[v];

        if (!vert.destroyed()) callback(vert, v);
      }
    },

    forEachEdge: function(callback) {
      for (var e = 0, l = this.edges.length; e < l; e++) {
        var edge = this.edges[e];

        if (!edge.destroyed()) callback(edge, e);
      }
    },

    forEachFace: function(callback) {
      for (var f = 0, l = this.faces.length; f < l; f++) {
        var face = this.faces[f];

        if (!face.destroyed()) callback(face, f);
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
        var edge = iter.val;

        var other = edge.v1 === vert ? edge.v2 : edge.v1;
        var v2 = other.v.clone().applyMatrix4(matrix);
        var d = v2.clone().sub(v1);
        var dist = d.length();
        d.normalize();

        total.add(d);

        debug.line(v1, v1.clone().addScaledVector(d, dist/4));
      } while (iter.next() !== iter.start);

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
        var face = riter.val.face;

        if (face.destroyed()) {
          continue;
        }

        var fcenter = new THREE.Vector3();
        var vnum = 0;

        var fiter = face.loopIterator();

        do {
          fcenter.add(fiter.val.vert.v);
          vnum++;
        } while (fiter.next() !== fiter.start);

        fcenter.divideScalar(vnum).applyMatrix4(matrix);

        var d = fcenter.clone().sub(ecenter);
        var dist = d.length();
        d.normalize();

        debug.line(ecenter, ecenter.clone().addScaledVector(d, dist/4));
      } while (riter.next() !== riter.start);

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
        fcenter.add(fiter.val.vert.v);
        vnum++;
      } while (fiter.next() !== fiter.start);

      fcenter.divideScalar(vnum).applyMatrix4(matrix);

      var iter = face.loopIterator();
      var len = 0;
      var ct = 0;

      do {
        ct++;

        var loop = iter.val;
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
      } while (iter.next() !== iter.start);

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
  //   loop = iter.val; // a BMLoop, if radial iterator
  // } while (iter.next() !== iter.start);

  // base type
  function Iterator(source) {
    this._source = source;
    this.val = null;
    this.start = null;
  }

  Object.assign(Iterator.prototype, {
    constructor: Iterator,

    next: function() {
      return this.val;
    },

    prev: function() {
      return this.val;
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

    this.val = vert.edge;
    this.start = this.val;
  }

  DiskIterator.prototype = Object.create(Iterator.prototype);
  Object.assign(DiskIterator.prototype, {
    constructor: DiskIterator,

    // go to the next edge in the disk
    next: function() {
      if (!this.val) return null;

      this.val = this.val.getVertDisk(this._source).next;

      return this.val;
    },

    // go to the previous edge in the disk
    prev: function() {
      if (!this.val) return null;

      this.val = this.val.getVertDisk(this._source).prev;

      return this.val;
    }
  });



  // iterates over BMLoops
  function LoopIterator(loop) {
    Iterator.call(this, loop);

    this.val = loop;
    this.start = this.val;
  }

  LoopIterator.prototype = Object.create(Iterator.prototype);
  Object.assign(LoopIterator.prototype, {
    constructor: LoopIterator,

    // go to the next loop in the cycle
    next: function() {
      if (!this.val) return null;

      this.val = this.val.next;

      return this.val;
    },

    // go to the previous loop in the cycle
    prev: function() {
      if (!this.val) return null;

      this.val = this.val.prev;

      return this.val;
    }
  });



  // iterates over the BMLoops in an edge's radial cycle
  function RadialIterator(edge) {
    Iterator.call(this, edge);

    this.val = edge.radial;
    this.start = this.val;
  }

  // member functions are the same as those of LoopIterator
  RadialIterator.prototype = Object.create(LoopIterator.prototype);
  Object.assign(RadialIterator.prototype, {
    constructor: RadialIterator
  });



  return BMesh;

}());
