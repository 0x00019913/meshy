KeyStack = function() {
  this.stack = {};
  this.count = 0;
}

KeyStack.prototype.add = function(item) {
  var key = 0;
  while (key in this.stack) key++;

  this.stack[key] = item;
  this.count++;
  return key;
}

KeyStack.prototype.remove = function(key) {
  if (key in this.stack) {
    delete this.stack[key];
    this.count--;
  }
  else console.log("Error: tried to delete nonexistent item at key "+key);
}

KeyStack.prototype.empty = function() {
  return this.count==0;
}

// if every element in the structure is a function, call each one with the arg
KeyStack.prototype.callEachWithArg = function(arg) {
  for (var key in this.stack) this.stack[key](arg);
}
