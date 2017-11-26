/* transform.js
   classes:
    Transform
    UndoStack
   description:
    A class representing a transformation. Has a reference to a model and can
    apply the appropriate transformation with .apply(). Has a method to generate
    an inverse transformation, which can be pushed onto an instance of
    UndoStack.
*/

// Constructor - transformation type, axis, amount, model object, and a printout
// to output messages for the user.
// Amount can be either a number or a Vector3.
function Transform(op, axis, amount, model, printout) {
  this.printout = printout ? printout : console;

  if (!model) {
    this.op = "noop";
    this.reason = "Model doesn't exist.";
    return this;
  }
  this.model = model;
  this.dynamic = false;
  this.amount = new THREE.Vector3(); // init to (0, 0, 0)

  switch (op) {
    case "floor":
      this.op = "translate";
      this.axis = axis;
      if (axis=="all") {
        this.amount.x = -1*model.xmin;
        this.amount.y = -1*model.ymin;
        this.amount.z = -1*model.zmin;
      }
      else {
        this.amount[axis] = -1 * model[axis+"min"];
      }
      break;
    case "center":
      this.op = "translate";
      this.axis = axis;
      if (axis=="all") {
        this.amount.x = -1*model.getCenterx();
        this.amount.y = -1*model.getCentery();
        this.amount.z = -1*model.getCenterz();
      }
      else {
        this.amount[axis] = -1 * model["getCenter"+axis]();
      }
      break;
    case "mirror":
      this.op = "mirror";
      this.axis = axis;
      break;
    case "translate":
      this.op = "translate";
      this.axis = axis;
      if (amount.isVector3) this.amount.copy(amount);
      else this.amount[axis] = amount;
      break;
    case "rotate":
      this.op = "rotate";
      if (axis=="all") {
        this.op = "noop";
        this.reason = "Cannot rotate on multiple axes at once.";
        return this;
      }
      this.axis = axis;
      if (amount.isVector3) this.amount.copy(amount);
      else this.amount[axis] = amount;
      break;
    case "scale":
      var isBadScale;
      if (amount.isVector3) isBadScale = amount.x<=0 || amount.y<=0 || amount.z<=0
      else isBadScale = amount<=0;

      if (isBadScale) {
        this.op = "noop";
        this.reason = "Can only scale by positive numbers: " + amount;
        return this;
      }

      this.op = "scale";
      this.axis = axis;
      // if amount is vector, use it as is; else, allow scaling on all axes
      // to be specified as a number (then scale on all axes by that number)
      if (amount.isVector3) this.amount.copy(amount);
      else {
        if (axis=="all") this.amount.set(amount, amount, amount);
        else {
          this.amount.set(1,1,1);
          this.amount[axis] = amount;
        }
      }
      break;
  }
  return this;
}

Transform.prototype = {
  constructor: Transform,

  // Creates and returns an inverse transform.
  makeInverse: function() {
    if (this.op=="noop") {
      return null;
    }

    var amount;
    if (this.op=="scale") {
      amount = new THREE.Vector3(1,1,1).divide(this.amount);
    }
    else { // translations and rotations
      amount = new THREE.Vector3(-1,-1,-1).multiply(this.amount);
    }

    var inv = new this.constructor(this.op, this.axis, amount, this.model);
    return inv;
  },

  // applies the transform
  apply: function() {
    switch (this.op) {
      case "noop":
        this.printout.warn(this.reason);
        return;
      case "translate":
        this.model.translate(this.axis, this.amount);
        break;
      case "rotate":
        this.model.rotate(this.axis, this.amount);
        break;
      case "scale":
        this.model.scale(this.axis, this.amount);
        break;
      case "mirror":
        this.model.mirror(this.axis);
        break;
    }
  },

  // The following are for transforming geometry dynamically (as opposed to
  // pressing a button to perform a discrete transformation), but I decided
  // to not use it because WebGL is weighty enough without moving hundreds of
  // thousands of vertices in real time.

  // this will come back when I move to transforming the matrix as opposed to
  // the vertices themselves

  /* Intended pattern for dynamic updates (not using because updating in
      real time in WebGL is slow for large meshes):
    // in UI setup using dat.gui
    this.xOffset = 0;
    this.xOffsetPrev = this.xOffset;
    translationFolder.add(this, "xOffset", -50, 50).onChange(this.translateXDynamic.bind(this).onFinishChange(this.endTranslateXDynamic.bind(this));
    ...
    // functions
    this.translateXDynamic = function() {
      if (!this.translationXDynamic) {
        this.translationXDynamic = new Transform("translate","x",0,this.model);
        this.translationXDynamic.setDynamicStart(this.xOffsetPrev);
      }
      var delta = this.xOffset - this.xOffsetPrev;
      this.translationXDynamic.setAmount(delta);
      this.translationXDynamic.apply();

      console.log(this);

      this.xOffsetPrev = this.xOffset;
    }
    this.endTranslateXDynamic = function() {
      this.undoStack.push(this.translationXDynamic.makeInverse());
      this.xOffsetPrev = this.xOffset;
      this.translationXDynamic = null;
    }
  */

  setDynamicStart: function(start) {
    this.dynamic = true;
    this.start = start;
  },

  setAmount: function(amount) {
    this.amount = amount;
  }

}

// Constructor - initialized with a printout object.
function UndoStack(printout) {
  this.printout = printout ? printout : console;
  // stack of transformations
  this.history = [];
  this.pos = -1
}

UndoStack.prototype = {
  constructor: UndoStack,

  // Get the inverse transform at current positition and apply it.
  undo: function() {
    if (this.pos < 0) {
      this.printout.warn("No undo history available.");
      return;
    }
    var inverse = this.history[this.pos--].inverse;
    inverse.apply();
  },

  // Get the transform at the next position and apply it.
  redo: function() {
    if (this.pos >= this.history.length-1) {
      this.printout.warn("No redo history available.");
      return;
    }
    var transform = this.history[++this.pos].transform;
    transform.apply();
  },

  // Put a new inverse transform onto the stack.
  push: function(transform, inverse) {
    if (this.pos < this.history.length-1) {
      // effectively deletes all entries after this.pos
      this.history.length = this.pos + 1;
    }
    if (transform && inverse) this.history.push({
      transform: transform,
      inverse: inverse
    });
    this.pos++;
  },

  // Clear the stack.
  clear: function() {
    this.history = [];
  }
}
