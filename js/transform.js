/* transform.js
   classes:
    Transform
    EditStack
   description:
    A class representing a transformation. Has a reference to a model and can
    apply the appropriate transformation with .apply(). Has a method to generate
    an inverse transformation, which can be pushed onto an instance of
    EditStack.
*/

function Transform() {
  // start and end value of transformed parameter
  this.startVal = null;
  this.endVal = null;

  // true if inverse
  this._inverse = false;

  // true if this transform can generate an inverse
  this._invertible = true;

  // functions to get start value and inverse end value
  this._getStartVal = null;
  this._getInverseEndVal = null;

  // functions called on transform application and transform end
  this._onApply = null;
  this._onEnd = null;
}

Transform.InversionFunctions = {
  negateVector3: function(newStartVal, startVal, endVal) {
    if (newStartVal === null || startVal === null || endVal === null) return null;
    return newStartVal.clone().add(startVal).sub(endVal);
  },

  reciprocateVector3: function(newStartVal, startVal, endVal) {
    if (newStartVal === null || startVal === null || endVal === null) return null;
    return newStartVal.clone().multiply(startVal).divide(endVal);
  },

  negateEuler: function(newStartVal, startVal, endVal) {
    if (newStartVal === null || startVal === null || endVal === null) return null;
    var newEndVal = newStartVal.clone();
    newEndVal.x += startVal.x - endVal.x;
    newEndVal.y += startVal.y - endVal.y;
    newEndVal.z += startVal.z - endVal.z;
    return newEndVal;
  }
};

Object.assign(Transform.prototype, {

  constructor: Transform,

  getInverse: function() {
    var sv = this.startVal;
    var ev = this.endVal;

    // if not invertible, return null
    if (!this._invertible) return null;

    // if transformation did nothing, no inverse
    if (ev !== null && sv !== null && sv.equals(ev)) return null;

    var inv = new this.constructor();

    // copy all properties
    Object.assign(inv, this);
    inv._inverse = true;

    return inv;
  },

  getStartVal: function(getStartVal) {
    this._getStartVal = getStartVal;
    return this;
  },

  getInverseEndVal: function(getInverseEndVal) {
    this._getInverseEndVal = getInverseEndVal;
    return this;
  },

  invertible: function(invertible) {
    this._invertible = invertible;
  },

  onApply: function(onApply) {
    this._onApply = onApply;
    return this;
  },

  onEnd: function(onEnd) {
    this._onEnd = onEnd;
    return this;
  },

  apply: function(endVal) {
    // if inverse, get new start value and compute the end value
    if (this._inverse) {
      var invStartVal = this._getStartVal();
      var invEndVal = this._getInverseEndVal(invStartVal, this.startVal, this.endVal);

      if (this._onApply) this._onApply(invEndVal);
    }
    // else, handle start and end values normally
    else {
      if (this.startVal === null) this.startVal = this._getStartVal().clone();

      // if ending value is given, record it
      if (endVal !== undefined) this.endVal = endVal.clone();

      // apply with current end value
      if (this._onApply) this._onApply(this.endVal);
    }

    return this;
  },

  end: function() {
    if (this._onEnd) this._onEnd();

    return this;
  }

});

// Constructor - initialized with a printout object.
function EditStack(printout) {
  this.printout = printout ? printout : console;
  // stack of transformations
  this.history = [];
  this.pos = -1
}

EditStack.prototype = {
  constructor: EditStack,

  // Get the inverse transform at current positition and apply it.
  undo: function() {
    if (this.pos < 0) {
      this.printout.warn("No undo history available.");
      return;
    }

    var entry = this.history[this.pos--];

    // apply inverse
    entry.inverse.apply();
    entry.inverse.end();

    // if update function exists, call it
    if (entry.onTransform) entry.onTransform();
  },

  // Get the transform at the next position and apply it.
  redo: function() {
    if (this.pos >= this.history.length-1) {
      this.printout.warn("No redo history available.");
      return;
    }

    var entry = this.history[++this.pos];

    // apply the transform and update function if given
    entry.transform.apply();
    entry.transform.end();

    // if update function exists, call it
    if (entry.onTransform) entry.onTransform();
  },

  // Put a new inverse transform onto the stack.
  push: function(transform, inverse, onTransform) {
    if (this.pos < this.history.length - 1) {
      // effectively deletes all entries after this.pos
      this.history.length = this.pos + 1;
    }
    if (transform && inverse) this.history.push({
      transform: transform,
      inverse: inverse,
      onTransform: onTransform || null
    });
    this.pos++;
  },

  // Clear the stack.
  clear: function() {
    this.history.length = 0;
    this.pos = -1;
  }
}
