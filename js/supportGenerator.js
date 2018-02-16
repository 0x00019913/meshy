function SupportGenerator(angle, resolution, layerHeight, axis, epsilon) {
  if (axis === undefined) axis = 'z';
  if (epsilon === undefined) epsilon = 0.0000001;

  // angle in radians
  this.angle = angle * Math.PI / 180;
  // used to determine overhangs
  this.dotProductCutoff = Math.cos(this.angle);
  this.resolution = resolution;
  this.layerHeight = layerHeight;
  this.axis = axis;
  this.epsilon = epsilon;

  this.down = new THREE.Vector3();
  this.down[axis] = -1;
}

SupportGenerator.prototype.generate = function(faces, vertices, min, max) {
  var axis = this.axis;
  var ah = cycleAxis(axis);
  var av = cycleAxis(ah);
  var epsilon = this.epsilon;
  var angle = this.angle;
  var minHeight = min[axis] + this.layerHeight/2;
  var resolution = this.resolution;

  var vs = vertices;
  var fs = faces;

  var nv = vs.length;
  var nf = fs.length;

  if (min===undefined) min = new THREE.Vector3().setScalar(-Infinity);

  var dotProductCutoff = this.dotProductCutoff;
  var down = this.down;

  var hds = new HDS(vertices, faces);

  // generate islands of overhang faces in the mesh
  var islands = generateOverhangIslands(hds);

  console.log(islands);

  for (var i=0; i<islands.length; i++) {
    break;
    var island = islands[i];
    for (var j=0; j<island.faces.length; j++) {
      var face3 = island.faces[j].face3;
      debug.point(faceGetCenter(face3, vs));
    }
    debug.points(i, 1);
  }

  // rasterize each island to find sampling points over every island
  var pointSets = samplePoints(islands);

  console.log(pointSets);

  for (var psi=0; psi<pointSets.length; psi++) {
    break;
    var points = pointSets[psi];
    for (var pi=0; pi<points.length; pi++) {
      debug.point(points[pi]);
    }
    debug.points(0);
  }

  // need an octree for raycasting

  // octree size is this plus largest mesh size
  var octreeOverflow = 0.01;
  // other params
  var octreeDepth = Math.round(Math.log(faces.length)*0.6);
  var octreeSize = vector3Max(max.clone().sub(min)) + octreeOverflow;
  var octreeCenter = max.clone().add(min).multiplyScalar(0.5);
  var octreeOrigin = octreeCenter.subScalar((octreeSize + octreeOverflow)/2);

  var octree = new Octree(octreeDepth, octreeOrigin, octreeSize, fs, vs, debug.scene);
  octree.construct();

  console.log(octree);

  // iterate through sampled points, build support trees

  // for every island's point set
  for (var psi = 0; psi < pointSets.length; psi++) {
    var points = pointSets[psi];

    // orders a priority queue from highest to lowest coordinate on axis
    var pqComparator = function (a, b) { return points[b][axis] - points[a][axis]; }
    var pq = new PriorityQueue({
      comparator: pqComparator
    });
    var activeIndices = new Set();

    // put the point indices on the priority queue;
    // also put them into a set of active indices so that we can take a point
    // and test it against all other active points to find the nearest
    // intersection; we could just iterate over the pq.priv.data to do the same,
    // but that's a hack that breaks encapsulation
    for (var pi = 0; pi < points.length; pi++) {
      activeIndices.add(pi);
      pq.queue(pi);
    }

    var ct = 0;
    var lim = 1000;
    while (pq.length > 0) {
      //if (++ct>lim) break;

      var pi = pq.dequeue();

      if (!activeIndices.has(pi)) continue;
      activeIndices.delete(pi);

      var p = points[pi];

      // find the closest intersection between p's cone and another cone
      var intersection = null;
      var minDist = Infinity;
      var qiTarget = -1;

      for (var qi of activeIndices) {
        var q = points[qi];
        var ixn = coneConeIntersection(p, q, angle, axis);
        if (ixn) {
          var dist = p.distanceTo(ixn);
          if (dist < minDist) {
            minDist = dist;
            intersection = ixn;
            qiTarget = qi;
          }
        }
      }

      // if p-q intersection exists, either p and q connect or p's ray to q hits
      // the mesh first
      if (intersection) {
        var qTarget = points[qiTarget];
        var d = intersection.clone().sub(p);
        var rayQ = octree.castRayExternal(p, d);

        // if p's ray to the intersection hits the mesh first, join it to the
        // mesh and leave q to join to something else later
        if (rayQ.dist < minDist) {
          var rayDown = octree.castRayExternal(p, down);
          if (rayQ.dist < rayDown.dist) {
            debug.line(p, rayQ.point);
          }
          else {
            debug.line(p, rayDown.point);
          }
        }
        // p and q can be safely joined
        else {
          activeIndices.delete(qiTarget);

          var newidx = points.length;
          points.push(intersection);
          activeIndices.add(newidx);
          pq.queue(newidx);

          debug.line(p, intersection);
          debug.line(points[qiTarget], intersection);
        }
      }
      // if no intersection between p and q, cast a ray down and build a strut
      // where it intersects the mesh or the ground
      else {
        var rayDown = octree.castRayExternal(p, down);
        debug.line(p, rayDown.point);
      }
    }

    debug.lines(psi);
  }

  function generateOverhangIslands(hds) {
    // return true if the given HDS face is an overhang and above the base plane
    var overhang = function(face) {
      var face3 = face.face3;
      var normal = face3.normal;
      var mx = faceGetMaxAxis(face3, vs, axis);
      return down.dot(normal) > dotProductCutoff && mx > minHeight;
    }

    return hds.groupIntoIslands(overhang);
  }

  function samplePoints(islands) {
    var pointSets = [];

    // rasterization lower bounds on h and v axes
    var rhmin = min[ah];
    var rvmin = min[av];

    // for each island
    for (var i = 0; i < islands.length; i++) {
      var island = islands[i];
      var faces = island.faces;
      var points = [];

      // iterate over all faces in the island
      for (var f = 0; f < faces.length; f++) {
        var face3 = faces[f].face3;
        var normal = face3.normal;
        var [a, b, c] = faceGetVerts(face3, vs);
        // bounding box
        var bb = faceGetBounds(face3, vs);

        // this face's lower bounds in rasterization space
        var hmin = rhmin + Math.floor((bb.min[ah] - rhmin) / resolution) * resolution;
        var vmin = rvmin + Math.floor((bb.min[av] - rvmin) / resolution) * resolution;
        // this face's upper bounds in rasterization space
        var hmax = rhmin + Math.ceil((bb.max[ah] - rhmin) / resolution) * resolution;
        var vmax = rvmin + Math.ceil((bb.max[av] - rvmin) / resolution) * resolution;

        // iterate over all possible points
        for (var ph = hmin; ph < hmax; ph += resolution) {
          for (var pv = vmin; pv < vmax; pv += resolution) {
            var pt = new THREE.Vector3();
            pt[ah] = ph;
            pt[av] = pv;

            // two triangle verts are flipped because the triangle faces down
            // and is thus wound CW when looking into the plane
            if (pointInsideTriangle(pt, b, a, c, axis, epsilon)) {
              points.push(projectToPlaneOnAxis(pt, a, normal, axis));
            }
          }
        }
      }

      // if the island is too small to hit any points in rasterization space,
      // just store the center of its first face
      if (points.length == 0) {
        var center = faceGetCenter(faces[0].face3, vs);
        points.push(center);
      }

      pointSets.push(points);
    }

    return pointSets;
  }
}

SupportGenerator.prototype.cleanup = function() {
  debug.cleanup();
}
