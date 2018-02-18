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
  var up = down.clone().negate();

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
  var supportGeometry = new THREE.Geometry();
  var strutRadius = 0.03;
  var strutThetaSteps = 2;
  var strutPhiSteps = 8;

  buildGeometry(supportGeometry);

  console.log(supportGeometry);

  return supportGeometry;

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

  function buildGeometry(supportGeometry) {
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

      while (pq.length > 0) {
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
              writeCapsuleGeometry(
                supportGeometry, strutRadius, p, rayQ.point, strutPhiSteps, strutThetaSteps
              );
            }
            else {
              writeCapsuleGeometry(
                supportGeometry, strutRadius, p, rayDown.point, strutPhiSteps, strutThetaSteps
              );
            }
          }
          // p and q can be safely joined
          else {
            activeIndices.delete(qiTarget);

            var newidx = points.length;
            points.push(intersection);
            activeIndices.add(newidx);
            pq.queue(newidx);

            writeCapsuleGeometry(
              supportGeometry, strutRadius, p, intersection, strutPhiSteps, strutThetaSteps
            );
            writeCapsuleGeometry(
              supportGeometry, strutRadius, points[qiTarget], intersection, strutPhiSteps, strutThetaSteps
            );
          }
        }
        // if no intersection between p and q, cast a ray down and build a strut
        // where it intersects the mesh or the ground
        else {
          var rayDown = octree.castRayExternal(p, down);
          writeCapsuleGeometry(
            supportGeometry, strutRadius, p, rayDown.point, strutPhiSteps, strutThetaSteps
          );
        }
      }
    }
  }

  // takes a geometry object and writes a capsule into it with the given radius,
  // start position, end position, and phi/theta increments; my convention for
  // spherical coords is that phi goes to 2pi, theta to pi, and so:
  //  x = r cos phi sin theta
  //  y = r sin phi sin theta
  //  z = r cos theta
  function writeCapsuleGeometry(geo, radius, start, end, phiSteps, thetaSteps) {
    var len = start.distanceTo(end);

    phiSteps = Math.max(phiSteps || 3, 3);
    thetaSteps = Math.max(thetaSteps || 8, 1);

    var direction = end.clone().sub(start).normalize();
    var rotationAxis = up.clone().cross(direction).normalize();
    var rotationAngle = Math.acos(direction.dot(up));

    // if start-to-end direction is vertical, don't rotate
    if (rotationAxis.length() == 0) {
      rotationAngle = 0;
      // capsule remains vertical; just set the lower of start and end as start
      if (start[axis] > end[axis]) {
        var tmp = start;
        start = end;
        end = tmp;
      }
    }

    // make the bottom cap
    var bot = new THREE.Vector3();
    var ibot = writeCapsuleCap(geo, radius, bot, phiSteps, thetaSteps, -1);

    // make the top cap
    var top = up.clone().multiplyScalar(len);
    var itop = writeCapsuleCap(geo, radius, top, phiSteps, thetaSteps, 1);

    // count the number of verts in this capsule, then rotate and translate
    // them into place
    var count = 2 * (1 + phiSteps * thetaSteps);
    positionGeometry(geo, count, rotationAngle, rotationAxis, start);

    writeCapsuleTorso(geo, ibot, itop, phiSteps);

    geo.elementsNeedUpdate = true;
    geo.verticesNeedUpdate = true;
    geo.normalsNeedUpdate = true;

    return;
  }

  // dir is 1 if upper cap, -1 if lower
  // returns length of geo.vertices
  function writeCapsuleCap(geo, radius, center, phiSteps, thetaSteps, dir, rAxis, rAngle) {
    var vertices = geo.vertices;
    var faces = geo.faces;

    var thetaStart = dir === 1 ? 0 : Math.PI;
    var dtheta = dir * Math.PI / (2 * thetaSteps);
    var dphi = dir * Math.PI * 2 / phiSteps;

    var nv = vertices.length;

    // vertices

    // top of the cap
    vertices.push(vertexFromSpherical(radius, thetaStart, 0, center));

    // rest of the cap
    for (var itheta = 1; itheta <= thetaSteps; itheta++) {
      var theta = thetaStart + itheta * dtheta;

      for (var iphi = 0; iphi < phiSteps; iphi++) {
        var phi = iphi * dphi;

        vertices.push(vertexFromSpherical(radius, theta, phi, center));
      }
    }

    // faces

    var idx = nv;

    for (var itheta = 1; itheta <= thetaSteps; itheta++) {
      for (var iphi = 0; iphi < phiSteps; iphi++) {
        idx++;

        // a-b is a segment on the previous row
        // c-d is the corresponding segment on the current row
        var a = (itheta == 1) ? nv : (idx - phiSteps);
        var b = a + 1;
        var c = idx;
        var d = c + 1;
        if (iphi == phiSteps - 1) {
          b -= phiSteps;
          d -= phiSteps;
        }

        var f0 = new THREE.Face3(a, c, d);
        faceComputeNormal(f0, vertices);
        faces.push(f0);

        // add a second face if not on the first row of the cap
        if (itheta > 1) {
          var f1 = new THREE.Face3(a, d, b);
          faceComputeNormal(f1, vertices);
          faces.push(f1);
        }
      }
    }

    return vertices.length;
  }

  // takes the last count verts from geo, rotates them, shifts them to pos
  function positionGeometry(geo, count, rotationAngle, rotationAxis, pos) {
    var vertices = geo.vertices;
    var nv = vertices.length;

    for (var i = nv - count; i < nv; i++) {
      var v = vertices[i];

      if (rotationAngle !== 0) v.applyAxisAngle(rotationAxis, rotationAngle);

      v.add(pos);
    }
  }

  // botEnd is 1 + the last index in bottom cap; analogously for top
  function writeCapsuleTorso(geo, botEnd, topEnd, phiSteps) {
    var vertices = geo.vertices;
    var faces = geo.faces;

    for (var i = 0; i < phiSteps; i++) {
      var a = topEnd + i - phiSteps;
      var b = a + 1;
      if (i == phiSteps - 1) b -= phiSteps;
      var c = botEnd - i;
      var d = c - 1;
      if (i == 0) c -= phiSteps;

      var f0 = new THREE.Face3(a, c, d);
      faceComputeNormal(f0, vertices);
      faces.push(f0);

      var f1 = new THREE.Face3(a, d, b);
      faceComputeNormal(f1, vertices);
      faces.push(f1);
    }
  }

  function vertexFromSpherical(r, theta, phi, center) {
    var v = new THREE.Vector3();
    var cp = Math.cos(phi);
    var sp = Math.sin(phi);
    var ct = Math.cos(theta);
    var st = Math.sin(theta);

    v.x = r * cp * st + center.x;
    v.y = r * sp * st + center.y;
    v.z = r * ct + center.z;

    return v;
  }
}

SupportGenerator.prototype.cleanup = function() {
  debug.cleanup();
}
