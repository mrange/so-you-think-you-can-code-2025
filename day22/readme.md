# Day 22: A Nest of Divergence-Free Fields

On creating complex, swirly shapes with compute shaders in Rust and wgpu.

> Absolutely no AI was used, which is why this post actually sounds like a person wrote it.

## What are we trying to do here?

Have a look at this image.

![A spiraling shape made of white strands.](assets/uzumaki.png)

That's pretty cool, isn't it? I made that in Blender in a few hours, using Geometry Nodes. And, I'll tell you this, I love Geometry Nodes. But I wanted to animate an effect like this in realtime, on the GPU, so that I could use it in demos and such-like things---notably, in my game <cite>Shaderland</cite>!

So what are we actually looking at? This is an example of integrating **curl noise**. It's a type of **vector field** which, crucially, has **zero divergence** everywhere (up to numerical precision, anyway).

### A quick overview of the maths

In slightly more detail: A <dfn>field</dfn> in this context is essentially a function of space. For any given point in 3D space, you can get a value. A mathematician would write that as\
$$f \colon \mathbf{r} \to S $$\
for some output set $S$, but we are programmers, so let's write it in Rust instead.

```rust
trait Field {
	type Output;

	fn evaluate(p: Point) -> Output;
}
```

A [<dfn>vector field</dfn>](https://en.wikipedia.org/wiki/Vector_field) is a field whose values are vectors---quantities with a magnitude and a direction. Some classic examples of vector fields are the wind and the magnetic field. In graphics we might also think of surface normals and hair directions.

```rust
impl Field for VectorField {
	type Output = Vector;
	//function ->Vector goes here!
}
```

You can do calculus on these! A full intro to vector calculus is *way* beyond the scope of this post, but just like you can calculate the derivative of a scalar-valued function, you can calculate the derivatives of a vector field, essentially by treating each component of the vector field as its own scalar-valued function and doing calculus on that.

Let's go over some notation. I'm going to be using physicist-style notation because guess what, I studied physics. So: if $\mathbf{F}(\mathbf{r})$ is a vector field, it has three components written $F_x(\mathbf{r})$, $F_y(\mathbf{r})$ and $F_z(\mathbf{r})$. $\mathbf{r}$ represents a point in space with components $x$, $y$ and $z$. We can calculate their derivatives, and generally speaking we'll be calculating partial derivatives such as $$\frac{F}$$

Today, we are specifically interested in [divergence-free fields](https://en.wikipedia.org/wiki/Solenoidal_vector_field). What that essentially means is that there are no 'sources' or 'sinks'. It's a field of vortices, much as you might observe in a fluid; you can get closed loops and helices but if you follow along the field, two field lines will never cross each other. But, it's also *noise*, which means it's a smoothly varying random-looking field.

In more mathematical terms, the <dfn>divergence</dfn> of a vector field $\mathbf{F}(\mathbf{r})$ is the vector field...

$$
\grad \cdot \mathbf{F} = \begin{pmatrix}
  \frac{\partial F_x}{\partial x} \\
  \frac{\partial F_y}{\partial y} \\
  \frac{\partial F_z}{\partial z}
\end{pmatrix}
$$

It has a sister operator, the <dfn>curl</dfn>, which is written

$$
\grad \cross \mathbf{F} = \begin{pmatrix}
  \frac{\partial F_z}{\partial y} - \frac{\partial F_y}{\partial z} \\
  \frac{\partial F_x}{\partial z} - \frac{\partial F_z}{\partial x} \\
  \frac{\partial F_y}{\partial x} - \frac{\partial F_x}{\partial z} \\
\end{pmatrix}
$$

In very rough terms, when you have nonzero divergence, the vector field is either spreading or converging at that point. And when you have nonzero curl, it's twisting around that point. Want to visualise that? [3Blue1Brown](https://www.youtube.com/watch?v=rB83DpBJQsE) has a nice little video on it.

## Begone, divergence!

Luckily, if you have a way to calculate noise (for example, good old Perlin noise), it's actually quite easy to calculate divergence-free noise!