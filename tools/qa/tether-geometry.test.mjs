// Visual geometry regression: centreline attachment, radius, closed seams and finite unit normals.
import assert from 'node:assert/strict';
import {TetherGeometry} from '../../src/gameplay/TetherGeometry.ts';
const sides=10;
const path=Array.from({length:21},()=>({x:0,y:0,z:0}));
const g=new TetherGeometry(path,sides),positions=g.positions,normals=g.normals;
let cases=0;
for(const [dx,dy,dz,sag,radius]of[[6,0,0,1.2,.055],[3,2,4,.4,.05],[0,6,0,0,.045],[0,0,0,1,.055],[0,0,0,0,.055],[8,-2,6,0,.03575]]){
 for(let i=0;i<path.length;i++){const t=i/(path.length-1);Object.assign(path[i],{x:dx*t,y:dy*t-4*t*(1-t)*sag,z:dz*t})}
 g.update(radius);assert.equal(g.positions,positions);assert.equal(g.normals,normals);
 for(let i=0;i<path.length;i++){
  const centre={x:0,y:0,z:0};
  for(let j=0;j<sides;j++){
   const k=(i*(sides+1)+j)*3;
   const x=positions[k]-path[i].x,y=positions[k+1]-path[i].y,z=positions[k+2]-path[i].z;
   assert.ok(Math.abs(Math.hypot(x,y,z)-radius)<1e-6,'ring radius changed');
   assert.ok(Math.abs(Math.hypot(normals[k],normals[k+1],normals[k+2])-1)<1e-6,'normal invalid');
   centre.x+=positions[k]/sides;centre.y+=positions[k+1]/sides;centre.z+=positions[k+2]/sides;
  }
  assert.ok(Math.hypot(centre.x-path[i].x,centre.y-path[i].y,centre.z-path[i].z)<1e-6,'cord detached from centreline');
  const k=i*(sides+1)*3,last=k+sides*3;
  assert.deepEqual(positions.slice(k,k+3),positions.slice(last,last+3),'open seam');
 }
 cases++;
}
console.log('QA_RESULT '+JSON.stringify({test:'tether-geometry',pass:true,notes:{cases,vertices:positions.length/3,verticalAndCoincident:true,reusesBuffers:true}}));
