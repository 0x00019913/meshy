# NB

This documentation is severely outdated at present. I just merged circa 400 commits and didn't have time to document everything. Will update shortly.

# Documentation:

`Meshy` is my browser-based tool for performing measurements and transformations on polygonal meshes, intended to make life easier for 3D printing folks. This post presents a comprehensive guide to all current features of the tool.

> More features in development at the time of writing: slicing, optimizations, more import/export formats, UI improvements.

# Requirements

A computer with a GPU and a browser capable of running WebGL, with Javascript enabled. Tested and works in the latest releases of Chrome and Firefox on Ubuntu and Windows. Appears to work in Opera.

# General use

The user can upload a mesh. At any given time, the tool can contain one mesh (the mesh can be comprised of multiple islands, but the geometry must all come from one file). The user can perform standard transformations (translations, rotations, scaling, floor, center, mirror) with respect to the axes, use any of `meshy`'s calculation, measurement, and repair tools, export the mesh, and change some viewport settings. The user can delete the mesh and then upload another.

# Interface and controls

The main viewport uses mouse and keyboard controls:

* left-click and drag to rotate the camera
* scroll wheel to zoom
* middle mouse button to pan
* `F` to center the camera on the mesh
* `C` turns on the center-of-mass indicator
* `ctrl+z` to undo
* `ctrl+y` or `ctrl+shift+z` to redo

The information box on the top left indicates computed quantities. Note that surface area, volume, and center of mass are left uncalculated to save computing power until the user manually presses the button to calculate them.

The dat.GUI box on the top right contains the user-interactive components.

The axis widget indicates the camera orientation. The outward-facing vector from a face of the cube points along the axis shown on the face.

The printout area next to the axis widget indicates status changes, events, and warnings.

# Import

Supported file formats are OBJ and STL (binary and ASCII). There appears to be a rough upper limit of 50-80MB on the upload size, which is in the neighborhood of what you'd use for 3D printing. I've been able to load meshes with around 1-2 million polygons. It depends on your browser and computer. If the page hangs, the file's too big.

`Meshy` uses the first 6 bytes of an STL file to determine whether a file is binary or ASCII - an ASCII file begins with the characters `'solid '`, while a binary file does not. The guideline is not absolutely binding, but Wikipedia warns explicitly against violating it.

## Note on units

Neither STL nor OBJ files have intrinsic units. I hear software will often interpret one STL unit as 1mm; else, you'll have to specify input units.

## Format specifics

<a href="https://en.wikipedia.org/wiki/STL_(file_format)">By Wikipedia</a>, face normals in STL files should be normalized (i.e., vectors of unit length); `meshy` doesn't assume this and normalizes them just in case. An insufficient number of vertices on a face (less than 3) causes the import to fail.

N-gons in OBJ files are disallowed (i.e., `meshy` grabs at most the first four vertices of a given face and ignores the rest). Quads are allowed, but triangulated.  A number of vertex indices less than 3 causes the import to fail.

Technical note: there's an endianness switch under Settings > Technical, which indicates the assumed endianness of the imported mesh.

# Export

The user can specify a filename and export as either OBJ or STL (`exportSTL` exports as binary STL, `exportSTLascii` exports as ASCII STL).

If the current mesh was imported as a binary STL, an exported binary STL file will retain the same 80-byte header; else, the exported header will be set to 80 0 bytes.

OBJ files will export a list of vertices and a list of triangles. Quads are not preserved; neither are normals nor UVs. None of these are typically required for 3D printing. I may change this in the future.

# Settings

The user can toggle the axis widget and the floor grid.

(Probably irrelevant for all cases but should still be documented: under Settings > Technical is a "vertex precision" field, set to 5 by default. This is used for importing STL files - I'm using a hash table to get a list of unique vertices from a list of faces. (<a href="https://0x00019913.github.io/2017/03/08/meshy-design-notes/">See here for an early writeup on this subject.</a>) A 3-vector like `[1.28573568, 0.00584586, 10.86187359]` turns into a hash like `"128574_585_1086187"`. More precision means more digits - increasing this number makes long hashes, decreasing it might incorrectly merge vertices. If your mesh is very, very small, you might need to increase this precision.)

# Mesh Display

Contains the following functions:

* `toggleCOM` recalculates the center of mass and toggles an indicator that shows its location
* `toggleWireframe` does what you'd expect
* `cameraToModel` centers the camera on the current mesh
* `meshColor` sets the color on the mesh material, white by default

# Transformations

After setting a transformation value, the user must click the button that applies the transformation. This is because dat.GUI (the GUI box I'm using) doesn't seem to allow functions to trigger upon pressing return.

Note that all transformations under the Transform folder are undoable via the undo button or Ctrl+Z.

## Translation

Self-explanatory.

## Rotation

Rotations are performed around the specified axis, clockwise if looking along the positive axis. Rotation angles are given in degrees.

## Scaling

Scaling is performed with respect to 0 on the specified axis, not around the mesh center.

`Meshy` has the following modes of scaling:

### By factor

Scale the mesh by a given factor on one axis at a time or all at once.

### To size

Scale the mesh to the given size on an axis; if the `scaleOnAllAxes` checkbox is checked, `meshy` will apply the same scaling to the other axes.

### To measurement

If a measurement is active, this folder will contain a selection box - use this to select one of the measured values. Enter a new value and press the `scaleToMeasurement` button to scale the mesh to match the new measurement value.

### To ring size

Press `mCircle` and set up a circle measurement around the inner circumference of the ring mesh. Select a size and scale - `meshy` will scale the ring to have the correct inner diameter. The ring sizes and their respective measurements are given according to the US, Canada, and Mexico standard <a href="https://en.wikipedia.org/wiki/Ring_size">as specified on Wikipedia</a>.

*NB: the new diameter will be in millimeters.* E.g., size 9.5 corresponds to an inner diameter of 19.35mm, so the ring will now measure 19.35 units. Make sure your printer/printing service is aware of this.

I advise deactivating the measurement after scaling (`mDeactivate` button) because the pointer code does raycasting at every frame, which is computationally costly and can cause lag.

## Floor

Translate the mesh along the given axis such that its lowest bound is at 0 on that axis.

## Center

Translate the mesh along the given axis (or all) such that its bounds are centered at 0 on the axis.

# Calculation

These functions calculate the indicated values. The resulting values are displayed in the info box on the top left of the screen.

Note that scaling the mesh erases the surface area and volume measurements.

# Measurement

Measurement is performed thusly:

* activate the desired measurement
* left-click the model to place markers
* once the necessary number of markers has been placed, the result of the measurement shows up in the info box
* placing more markers performs the measurement again, replacing old markers on a FIFO (first in, first out) basis

`Meshy` has the following modes of measurement:

## Length

Takes 2 markers; measures the Euclidean distance between the markers.

## Angle

Takes 3 markers; measures the angle between two segments formed between them.

## Circle

Takes 3 markers, which specify a circle in 3-space; measures radius, diameter, circumference, and arc length between the first and last markers.

## Cross-sectional area

Takes 1 marker; measures the cross-sectional area in the plane normal (perpendicular) to the given axis. Note that this measurement is deactivated by rotating on any other axis.

Also calculates the size of the cross-section along the two axes lying in the measuring plane.

# Mesh Thickness

Visualizes approximate mesh thickness below the specified threshold. This is done by casting a ray along each face's negative normal and measuring the distance it travels before hitting the inside of the mesh.

Any part of the mesh that's below the threshold `t` is shown in red, interpolated linearly from full white to full red over the `[t, 0]` interval.

The UI is accessible while this is happening (the octree for the mesh is initially built if not already present, and mesh thickness is calculated), but performing any transformation or deleting the mesh cancels any ongoing calculation. The advantage of leaving the UI accessible is that 1. the user can do measurements and calculations in the meantime and 2. the entire tool doesn't lock up indefinitely without any feedback.

(NB: consulting the original paper that prompted this method - "Consistent Mesh Partitioning and Skeletonisation using the Shape Diameter Function" - one will see that the SDF is canonically calculated by casting 30 rays in a wide cone; however, I settled for only casting one ray because this is already quite expensive to do in a non-parallel way. One ray provides a poor approximation, but it should nonetheless give a fair idea of where the mesh is thin.)

Possible alternatives to this method, which I may implement eventually:

1. use the full SDF (30 rays in a 120-degree cone) over a randomly picked set of faces, then interpolate the SDF over the remaining surface, and
2. remesh the model to a much lower resolution such that the polygon distribution is more or less even (presumably via the octree) and details are preserved, then do the full SDF over the new model's faces; this seems to vaguely describe Shapeways's internal algorithm and makes a lot of sense to me.

# Repair (beta)

Patches holes surrounded by loops of edges that each border one triangle. First, generate the patch with `generatePatch`, which will fill in holes with preview (green) geometry. Then either accept it to integrate it into the model or cancel the patch. This is not undoable.

This algorithm is new and may throw errors (or just fail to patch something). Do let me know via email (0x00019913@gmail.com) or <a href="https://github.com/0x00019913/meshy">on the repo</a> and send me the model in question.

For a broad overview of how it works, see "A robust hole-filling algorithm for triangular mesh", Zhao, Gao, Lin, 2007.

# Slice

At the time of writing, the slicing functionality is rudimentary - the mesh is sliced along one particular plane, with everything above the plane hidden. TODO in the very near future: triangulate the hole and make slices over the entire mesh, exporting them as G-code.

# Undo

*Only the actions under the Transform folder are undoable.* This is because 1. the memory limitations of the typical browser make a more robust undo stack not generally feasible and 2. the sequence of actions performed in `meshy` would, by and large, be minimal and easily replicated in case of a faux pas.

`ctrl+Z` triggers the undo.

# Redo

`ctrl+y` and `ctrl+shift+z` trigger the redo.

# Delete

This action is not undoable. It removes all geometry data from the current state, allowing the user to import another mesh.
