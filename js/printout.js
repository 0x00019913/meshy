/* printout.js
   classes:
    Printout
   description:
    An on-screen console for printing messages for the user.
    Automatically inserts the HTML element.
    API emulates the console - methods are log, warn, and error.
*/

/* Constructor - initialize w/ the max number of lines that can be on the
   screen, default is 6.
*/
function Printout(maxCount) {
  this.count = 0;
  this.maxCount = maxCount ? maxCount : 6;

  this.minOpacity = 0.2;

  this.container = document.createElement('div');
  this.container.id = "printout";
  this.styleContainer();
  document.body.appendChild(this.container);
}

// Print white text.
Printout.prototype.log = function(str) {
  var entry = this.makeEntry(str);
  this.printLine(entry);
}

// Print yellow text.
Printout.prototype.warn = function(str) {
  var entry = this.makeEntry(str);
  entry.style.color = "#ffcc00";
  this.printLine(entry);
}

// Print red text.
Printout.prototype.error = function(str) {
  var entry = this.makeEntry(str);
  entry.style.color = "#ff3333";
  this.printLine(entry);
}

// Put down a line in the printout.
Printout.prototype.printLine = function(entry) {
  var children = this.container.children;
  if (this.count>=this.maxCount) {
    this.container.removeChild(children[0]);
  }
  else {
    this.count++;
  }
  this.container.appendChild(entry);

  var opacity = 1.0;
  var dOpacity = (1.0-this.minOpacity) / this.maxCount;
  for (var i=children.length-1; i>=0; i--) {
    children[i].style.opacity = opacity;
    opacity -= dOpacity;
  }
}

// Create and style a span to contain a new line.
Printout.prototype.makeEntry = function(str) {
  var entry = document.createElement('span');
  entry.style.display = "block";
  entry.style.height = "16px";
  entry.textContent = str;
  return entry;
}

// Style the container.
Printout.prototype.styleContainer = function() {
  this.container.style.maxHeight = (this.maxCount*16) + "px";
  this.container.style.position = "absolute";
  this.container.style.bottom = "15";
  this.container.style.left = "130px";
  this.container.style.backgroundColor = "transparent";
  this.container.style.overflowY = "hidden";
  this.container.style.userSelect = "none";

  this.container.style.color = "#eee";
  this.container.style.font = "11px Lucida Grande, sans-serif";
  this.container.style.textShadow = "0 -1px 0 #111";
}
