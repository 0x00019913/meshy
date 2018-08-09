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
  this.inverse = false;

  // functions to get start value and inverse end value
  this.startValFn = null;
  this.inverseEndValFn = null;

  // functions called on transform application and transform end
  this.applyFn = null;
  this.endFn = null;
}

Object.assign(Transform.prototype, {

  constructor: Transform,

  getInverse: function() {
    var sv = this.startVal;
    var ev = this.endVal;

    // if transformation did nothing, no inverse
    if (ev !== null && sv !== null && sv.equals(ev)) return null;

    var inv = new this.constructor();

    // copy all properties
    Object.assign(inv, this);
    inv.inverse = true;

    return inv;
  },

  setStartValFn: function(startValFn) {
    this.startValFn = startValFn;
    return this;
  },

  setInverseEndValFn: function(inverseEndValFn) {
    this.inverseEndValFn = inverseEndValFn;
    return this;
  },

  setApplyFn: function(applyFn) {
    this.applyFn = applyFn;
    return this;
  },

  setEndFn: function(endFn) {
    this.endFn = endFn;
    return this;
  },

  apply: function(endVal) {
    // if inverse, get new start value and compute the end value
    if (this.inverse) {
      var invStartVal = this.startValFn();
      var invEndVal = this.inverseEndValFn(invStartVal, this.startVal, this.endVal);

      if (this.applyFn) this.applyFn(invEndVal);
    }
    // else, handle start and end values normally
    else {
      if (this.startVal === null) this.startVal = this.startValFn().clone();

      // if ending value is given, record it
      if (endVal !== undefined) this.endVal = endVal.clone();

      // apply with current end value
      if (this.applyFn) this.applyFn(this.endVal);
    }

    return this;
  },

  end: function() {
    if (this.endFn) this.endFn();

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
