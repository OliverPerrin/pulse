const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionButton = document.querySelector('#motion-toggle');
let paused = reducedMotion.matches;
let sculptureController;

function updateMotion() {
  document.documentElement.classList.toggle('motion-paused', paused);
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.textContent = paused ? 'Play motion' : 'Pause motion';
  sculptureController?.refresh();
}
motionButton.addEventListener('click', () => { paused = !paused; updateMotion(); });
reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; updateMotion(); });

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus = false) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(item.getAttribute('aria-controls'));
    panel.hidden = !selected;
    panel.classList.toggle('is-entering', selected && !paused);
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(tabs[next], true);
  });
}

const demo = document.querySelector('#demo-perspective');
const demoWindow = document.querySelector('#demo-window');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
demo.addEventListener('pointermove', event => {
  if (paused || !finePointer.matches || innerWidth <= 800) return;
  const rect = demo.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - .5;
  const y = (event.clientY - rect.top) / rect.height - .5;
  demoWindow.style.transform = `rotateX(${3 - y * 3}deg) rotateY(${x * 3}deg)`;
});
demo.addEventListener('pointerleave', () => { demoWindow.style.transform = ''; });

// A small, self-contained WebGL sculpture. Geometry stays on the GPU; motion
// stops outside the viewport, in background tabs, or when the visitor pauses it.
function createSculpture() {
  const host = document.querySelector('#sculpture');
  const canvas = document.querySelector('#pulse-canvas');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: false });
  if (!gl) return null;
  const vertex = `
    attribute vec3 position;
    attribute vec3 normal;
    uniform vec3 rotation;
    uniform float aspect;
    uniform float floatY;
    varying vec3 worldPosition;
    varying vec3 worldNormal;
    mat3 rx(float a) { float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
    mat3 ry(float a) { float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
    mat3 rz(float a) { float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
    void main() {
      mat3 transform=rz(rotation.z)*ry(rotation.y)*rx(rotation.x);
      worldPosition=transform*position+vec3(0.,floatY,0.);
      worldNormal=transform*normal;
      vec3 view=worldPosition-vec3(0.,0.,8.7);
      gl_Position=vec4(view.x*2.414/aspect,view.y*2.414,-1.004*view.z-.2004,-view.z);
    }`;
  const fragment = `
    precision mediump float;
    varying vec3 worldPosition;
    varying vec3 worldNormal;
    void main() {
      vec3 n=normalize(worldNormal);
      vec3 v=normalize(vec3(0.,0.,8.7)-worldPosition);
      vec3 r=reflect(-v,n);
      float fresnel=pow(1.-max(dot(n,v),0.),4.);
      vec3 metal=vec3(.48,.76,.58);
      vec3 room=mix(vec3(.015,.027,.021),vec3(.73,.91,.77),smoothstep(-.65,.8,r.y));
      float softbox=pow(max(dot(r,normalize(vec3(-.55,.65,1.))),0.),28.);
      float edgebox=pow(max(dot(r,normalize(vec3(.9,.15,.25))),0.),65.);
      float strip=pow(max(1.-abs(r.x*.8+r.y*.22-.04),0.),65.)*smoothstep(-.2,.8,r.z);
      room+=vec3(1.,1.,.94)*softbox*1.7+vec3(.53,.96,.73)*edgebox*1.35+vec3(.8,1.,.85)*strip*.55;
      float diffuse=max(dot(n,normalize(vec3(-.3,1.,.8))),0.);
      vec3 color=room*mix(metal,vec3(.95,1.,.97),fresnel*.72)+metal*diffuse*.07;
      color*=.83+.17*smoothstep(-2.5,2.5,worldPosition.y);
      color=color/(color+vec3(.75));
      color=pow(color,vec3(.82));
      gl_FragColor=vec4(color,1.);
    }`;
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const normalize = a => { const length=Math.hypot(...a); return a.map(v=>v/length); };
  const subtract = (a,b) => a.map((v,i)=>v-b[i]);
  const center = t => [(1.65+.54*Math.cos(3*t))*Math.cos(2*t),(1.65+.54*Math.cos(3*t))*Math.sin(2*t),.72*Math.sin(3*t)];
  const rings=240, sides=24;
  const points=[], normals=[], vertices=[];
  for (let i=0;i<=rings;i++) {
    const t=i/rings*Math.PI*2, p=center(t);
    const tangent=normalize(subtract(center(t+.001),center(t-.001)));
    const axis=normalize(cross(tangent,[0,0,1]));
    const binormal=normalize(cross(tangent,axis));
    for (let j=0;j<=sides;j++) {
      const a=j/sides*Math.PI*2;
      const n=axis.map((value,k)=>value*Math.cos(a)+binormal[k]*Math.sin(a));
      points.push(p.map((value,k)=>value+n[k]*.235)); normals.push(n);
    }
  }
  const add = index => vertices.push(...points[index],...normals[index]);
  for (let i=0;i<rings;i++) for (let j=0;j<sides;j++) {
    const a=i*(sides+1)+j, b=a+sides+1;
    [a,b,a+1,b,b+1,a+1].forEach(add);
  }
  let program, buffer, rotationUniform, aspectUniform, floatUniform;
  function initialize() {
    function shader(type, source) {
      const result=gl.createShader(type); gl.shaderSource(result,source); gl.compileShader(result);
      if (!gl.getShaderParameter(result,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
      return result;
    }
    const vs=shader(gl.VERTEX_SHADER,vertex), fs=shader(gl.FRAGMENT_SHADER,fragment);
    program=gl.createProgram(); gl.attachShader(program,vs); gl.attachShader(program,fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    for (const [name,offset] of [['position',0],['normal',12]]) {
      const location=gl.getAttribLocation(program,name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,3,gl.FLOAT,false,24,offset);
    }
    rotationUniform=gl.getUniformLocation(program,'rotation'); aspectUniform=gl.getUniformLocation(program,'aspect'); floatUniform=gl.getUniformLocation(program,'floatY');
    gl.enable(gl.DEPTH_TEST); gl.clearColor(0,0,0,0);
  }
  initialize();
  let frame=0, previous=0, elapsed=0, visible=true, lost=false;
  let pointerX=0, pointerY=0, currentX=0, currentY=0;
  function draw(now) {
    frame=0;
    if (lost || !visible || document.hidden) { previous=0; return; }
    const moving=!paused;
    if (moving && previous && now-previous < 1000/30) { frame=requestAnimationFrame(draw); return; }
    const delta=previous ? Math.min((now-previous)/1000,.05) : 0;
    previous=now;
    if (moving) elapsed+=delta;
    currentX+=(pointerX-currentX)*.06; currentY+=(pointerY-currentY)*.06;
    const dpr=Math.min(devicePixelRatio||1,1.7);
    const width=Math.round(canvas.clientWidth*dpr), height=Math.round(canvas.clientHeight*dpr);
    if (width!==canvas.width || height!==canvas.height) { canvas.width=width; canvas.height=height; gl.viewport(0,0,width,height); }
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.uniform3f(rotationUniform,.38+Math.sin(elapsed*.18)*.08+(moving?currentY*.14:0),-.48+elapsed*.045+(moving?currentX*.2:0),-.27);
    gl.uniform1f(aspectUniform,width/Math.max(1,height)); gl.uniform1f(floatUniform,Math.sin(elapsed*.7)*.055);
    gl.drawArrays(gl.TRIANGLES,0,vertices.length/6);
    host.classList.add('is-ready');
    if (moving) frame=requestAnimationFrame(draw);
  }
  function refresh() { if (frame) cancelAnimationFrame(frame); frame=0; previous=0; if (!lost && visible && !document.hidden) frame=requestAnimationFrame(draw); }
  new ResizeObserver(refresh).observe(host);
  new IntersectionObserver(([entry])=>{ visible=entry.isIntersecting; refresh(); },{rootMargin:'60px'}).observe(host);
  document.addEventListener('visibilitychange',refresh);
  host.addEventListener('pointermove',event=>{
    if (paused || !finePointer.matches) return;
    const rect=host.getBoundingClientRect(); pointerX=(event.clientX-rect.left)/rect.width-.5; pointerY=(event.clientY-rect.top)/rect.height-.5;
  });
  host.addEventListener('pointerleave',()=>{ pointerX=0; pointerY=0; });
  canvas.addEventListener('webglcontextlost',event=>{ event.preventDefault(); lost=true; host.classList.remove('is-ready'); refresh(); });
  canvas.addEventListener('webglcontextrestored',()=>{ try { initialize(); lost=false; refresh(); } catch { host.classList.remove('is-ready'); } });
  refresh();
  return {refresh};
}
try { sculptureController=createSculpture(); } catch (error) { console.warn('Pulse is using its static illustration.',error.message); }
updateMotion();
