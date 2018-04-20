/*
  Integer point based on a Vector3, expanded to p decimal places.
*/

MCG.Vector = (function() {

  function Vector(context, h, v) {
    this.context = context || new MCG.Context();

    this.h = h || 0;
    this.v = v || 0;

    this.type = MCG.Types.vector;
  }

  Object.assign(Vector.prototype, {

    fromVector3: function(v3) {
      var p = this.context.p;

      this.h = numHash(v3[this.context.ah], p);
      this.v = numHash(v3[this.context.av], p);

      return this;
    },

    toVector3: function(constructor) {
      constructor = constructor || THREE.Vector3;

      var context = this.context;
      var p = context.p;

      var res = new constructor();
      res[context.axis] = context.d;
      res[context.ah] = this.h / p;
      res[context.av] = this.v / p;

      return res;
    },

    set: function(h, v) {
      this.h = Math.round(h);
      this.v = Math.round(v);

      return this;
    },

    copy: function(other) {
      this.h = other.h;
      this.v = other.v;
      this.context = other.context;

      return this;
    },

    clone: function() {
      return new this.constructor().copy(this);
    },

    hash: function() {
      return this.h + "_" + this.v;
    },

    sh: function() {
      return this.h / this.context.p;
    },

    sv: function() {
      return this.v / this.context.p;
    },

    add: function(other) {
      this.h += other.h;
      this.v += other.v;

      return this;
    },

    sub: function(other) {
      this.h -= other.h;
      this.v -= other.v;

      return this;
    },

    addScaledVector: function(other, s) {
      return this.set(this.h + other.h * s,
                      this.v + other.v * s);
    },

    length: function() {
      return Math.sqrt(this.h * this.h + this.v * this.v);
    },

    distanceToSq: function(other) {
      var dh = this.h - other.h, dv = this.v - other.v;
      return dh * dh + dv * dv;
    },

    distanceTo: function(other) {
      return Math.sqrt(this.distanceToSq(other));
    },

    vectorTo: function(other) {
      var res = new this.constructor().copy(other);
      return res.sub(this);
    }

  });

  return Vector;

})();
