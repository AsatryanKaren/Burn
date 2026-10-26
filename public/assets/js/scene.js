/*
 * Fire scene: a full-screen WebGL night with Ararat, a campfire and a paper that burns.
 * Usage:
 *   const scene = FireScene.create(canvas, { layout: "hero" | "center" });
 *   scene.burnPaper({ text, fromEl }).then(...)
 * Needs three.js r128 (window.THREE) and GSAP (window.gsap). Falls back to a CSS glow when WebGL is missing.
 */
(function () {
  "use strict";

  var NOISE = [
    "float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }",
    "float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);",
    "  return mix(mix(hash12(i),hash12(i+vec2(1.0,0.0)),u.x), mix(hash12(i+vec2(0.0,1.0)),hash12(i+vec2(1.0,1.0)),u.x), u.y); }",
    "const mat2 ROT=mat2(1.6,1.2,-1.2,1.6);",
    "float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p=ROT*p; a*=0.5; } return v; }",
    "float fbm3(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<3;i++){ v+=a*vnoise(p); p=ROT*p; a*=0.5; } return v; }"
  ].join("\n");

  var V_SCREEN = "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }";
  var V_OBJ = "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }";

  // Static night: sky, stars, moon, Ararat (Masis left, Sis right, as seen from Yerevan), plain with village lights.
  var F_BG = [
    "uniform vec2 uRes; uniform float uPR; uniform float uHorizon; uniform float uMX; uniform float uMH; uniform float uSX; uniform float uSH;",
    "uniform vec3 uMoon;",
    NOISE,
    "float hM(float x){ float d=(x-uMX)/(uMH*2.4); d*= d<0.0?0.72:1.0;",
    "  float h=uMH*exp(-pow(abs(d)*2.6,1.4));",
    "  h+=uMH*0.035*exp(-pow((x-(uMX+uMH*0.3))/(uMH*0.2),2.0));",
    "  return h; }",
    "float hS(float x){ float d=abs(x-uSX)/(uSH*1.75); float r=sqrt(d*d+0.0025)-0.05; return uSH*pow(max(0.0,1.0-r),1.25); }",
    "float heightAt(float x){ float a=hM(x); float b=hS(x); float k=uMH*0.1; float hh=max(k-abs(a-b),0.0)/k; float h=max(a,b)+hh*hh*k*0.25;",
    "  h+=(fbm(vec2(x*0.012,1.7))-0.5)*uMH*0.06*smoothstep(0.0,uMH*0.25,h);",
    "  float hills=uMH*0.035+(fbm(vec2(x*0.007,4.0))-0.5)*uMH*0.07;",
    "  return max(h,hills); }",
    "vec3 skyCol(float t){",
    "  vec3 c=mix(vec3(0.19,0.105,0.13),vec3(0.06,0.075,0.155),smoothstep(0.0,0.32,t));",
    "  c=mix(c,vec3(0.012,0.018,0.048),smoothstep(0.28,1.0,t));",
    "  return c; }",
    "float stars(vec2 px, float cell, float thr, float sz){",
    "  vec2 id=floor(px/cell); float h=hash12(id+cell); if(h<thr) return 0.0;",
    "  vec2 o=vec2(hash12(id+7.1),hash12(id+3.7))*(cell-4.0)+2.0; float d=length(px-(id*cell+o));",
    "  float b=(h-thr)/(1.0-thr); return exp(-d*d/(sz*sz))*(0.35+b*0.9); }",
    "void main(){",
    "  vec2 px=gl_FragCoord.xy/uPR; float y=px.y-uHorizon; float x=px.x;",
    "  float t=clamp(y/max(1.0,uRes.y-uHorizon),0.0,1.0);",
    "  vec3 sky=skyCol(t);",
    "  sky+=vec3(0.13,0.05,0.04)*exp(-max(y,0.0)/45.0);",
    "  vec2 dir=normalize(vec2(0.55,1.0)); vec2 nrm=vec2(-dir.y,dir.x); vec2 c0=vec2(uRes.x*0.62,uRes.y*0.62);",
    "  float across=dot(px-c0,nrm); float along=dot(px-c0,dir);",
    "  float band=exp(-pow(across/(uRes.y*0.13),2.0));",
    "  float mw=fbm(vec2(along*0.006,across*0.018))*fbm(vec2(along*0.02,across*0.03)+3.0);",
    "  sky+=vec3(0.075,0.08,0.11)*mw*band*smoothstep(0.15,0.55,t)*1.3;",
    "  float s=stars(px,7.0,0.975,0.7)+stars(px,16.0,0.93,0.95)*1.2+stars(px,5.0,1.0-0.03*band,0.55)*0.6;",
    "  vec3 starC=mix(vec3(1.0,0.86,0.72),vec3(0.75,0.85,1.0),hash12(floor(px/7.0)));",
    "  sky+=starC*s*smoothstep(0.04,0.35,t);",
    "  float md=length(px-uMoon.xy); float r=uMoon.z;",
    "  float disc=smoothstep(r+0.9,r-0.9,md);",
    "  float crat=fbm((px-uMoon.xy)*0.35+11.0);",
    "  vec3 moonC=vec3(0.95,0.93,0.86)*(0.86+0.14*smoothstep(0.35,0.65,crat));",
    "  sky+=vec3(0.55,0.62,0.8)*(exp(-md/(r*4.0))*0.16+exp(-md/(r*20.0))*0.05);",
    "  sky=mix(sky,moonC,disc);",
    "  vec3 col=sky;",
    "  if(y>-1.0){",
    "    float h=heightAt(x);",
    "    float m=smoothstep(-0.8,0.8,h-y);",
    "    if(m>0.0){",
    "      float slope=(heightAt(x+uMH*0.12)-heightAt(x-uMH*0.12))/(uMH*0.24);",
    "      float light=clamp(0.5+slope*0.9,0.0,1.0);",
    "      float depth=h-y;",
    "      float gul=fbm(vec2(x*0.045+y*0.006,y*0.02)); float ridged=1.0-abs(gul*2.0-1.0);",
    "      vec3 rock=mix(vec3(0.03,0.037,0.062),vec3(0.07,0.08,0.115),light*0.75+ridged*0.25);",
    "      float fing=pow(fbm(vec2(x*0.045,3.0)),2.2)*uMH*0.3+pow(fbm(vec2(x*0.11,9.0)),3.0)*uMH*0.12;",
    "      float snowLine=uMH*0.7+(fbm(vec2(x*0.015,2.0))-0.5)*uMH*0.14-fing+(fbm(vec2(x,y)*0.07)-0.5)*uMH*0.05;",
    "      float sn=smoothstep(snowLine-1.5,snowLine+5.0,y);",
    "      sn*=1.0-0.35*smoothstep(0.62,0.75,fbm(vec2(x*0.035,y*0.06)+5.0));",
    "      vec3 snow=vec3(0.3,0.345,0.45)*(0.45+0.7*light)*(0.85+0.15*fbm3(vec2(x,y)*0.15));",
    "      vec3 mc=mix(rock,snow,sn*0.95);",
    "      mc+=vec3(0.22,0.25,0.32)*smoothstep(3.0,0.0,depth)*light*0.45;",
    "      vec3 haze=skyCol(0.06)*0.85;",
    "      mc=mix(mc,haze,0.12+0.4*(1.0-smoothstep(0.0,uMH*0.3,y)));",
    "      col=mix(col,mc,m);",
    "    }",
    "  }",
    "  if(y<1.0){",
    "    float g=-y;",
    "    vec3 gc=mix(vec3(0.05,0.042,0.055),vec3(0.012,0.013,0.019),smoothstep(0.0,uHorizon*0.3,g));",
    "    gc*=0.85+0.3*fbm(vec2(x*0.05,g*0.15));",
    "    float cell=floor(x/9.0); float rr=hash12(vec2(cell,5.0));",
    "    if(rr>0.9){ vec2 lp=vec2(cell*9.0+2.0+hash12(vec2(cell,2.0))*5.0, -1.5-hash12(vec2(cell,9.0))*5.0);",
    "      float ld=length(vec2(x,y)-vec2(lp.x,lp.y)); gc+=vec3(1.0,0.66,0.32)*(exp(-ld*ld*1.4)*0.9+exp(-ld*0.6)*0.05)*(0.4+rr*0.6); }",
    "    col=mix(gc,col,smoothstep(-0.8,0.8,y));",
    "  }",
    "  gl_FragColor=vec4(col*0.5,1.0);",
    "}"
  ].join("\n");

  var F_BGCOPY = [
    "uniform sampler2D uBg; uniform vec2 uRes; uniform float uPR; uniform vec2 uFire; uniform float uFW; uniform float uLight; uniform float uHorizon;",
    "void main(){ vec2 px=gl_FragCoord.xy/uPR; vec2 uv=gl_FragCoord.xy/(uRes*uPR);",
    "  vec3 c=texture2D(uBg,uv).rgb;",
    "  vec2 d=(px-uFire)/vec2(uFW*1.7,uFW*0.42); float fl=exp(-dot(d,d)*1.3);",
    "  float ground=1.0-smoothstep(-2.0,2.0,px.y-uHorizon);",
    "  c+=vec3(1.0,0.38,0.1)*fl*ground*0.34*uLight*0.5;",
    "  vec2 d2=(px-uFire-vec2(0.0,uFW*0.7))/vec2(uFW*2.0,uFW*1.8); c+=vec3(1.0,0.38,0.1)*exp(-dot(d2,d2))*0.04*uLight*0.5;",
    "  gl_FragColor=vec4(c,1.0); }"
  ].join("\n");

  var F_HEARTH = [
    "uniform float uTime; uniform float uLight; uniform float uFW; uniform vec2 uSize; uniform float uFront;",
    "varying vec2 vUv;",
    NOISE,
    "float capsule(vec2 p, vec2 a, vec2 b, float r, out float t, out float s){ vec2 pa=p-a; vec2 ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);",
    "  vec2 q=pa-ba*h; t=h; vec2 n=normalize(vec2(-ba.y,ba.x)); if(n.y<0.0) n=-n; s=dot(q,n)/r; return length(q)-r; }",
    "vec4 over(vec4 dst, vec4 src){ return src+dst*(1.0-src.a); }",
    "vec4 logC(vec2 p, vec2 a, vec2 b, float r, float seed){",
    "  float t; float s; float d=capsule(p,a,b,r,t,s); float aa=1.2/uFW;",
    "  float m=smoothstep(aa,-aa,d); if(m<=0.0) return vec4(0.0);",
    "  float Lpx=length(b-a)*uFW; float ax=t*Lpx;",
    "  float bark=fbm(vec2(ax*0.07+seed*10.0,s*2.2));",
    "  float grain=fbm(vec2(ax*0.02+seed,s*7.0));",
    "  vec2 wp=mix(a,b,t);",
    "  float heat=exp(-length((wp-vec2(0.0,0.17))*vec2(1.0,1.6))/0.26);",
    "  vec3 barkC=mix(vec3(0.075,0.045,0.03),vec3(0.19,0.12,0.075),bark)*(0.8+0.4*grain);",
    "  vec3 charC=mix(vec3(0.018,0.016,0.015),vec3(0.07,0.06,0.055),bark);",
    "  vec3 base=mix(barkC,charC,smoothstep(0.12,0.55,heat));",
    "  float nz=sqrt(max(0.0,1.0-s*s));",
    "  float up=clamp(0.5+0.5*s,0.0,1.0);",
    "  float diff=up*0.8+nz*0.25;",
    "  vec3 col=base*(0.1+diff*uLight*vec3(1.7,0.8,0.4)*(0.45+heat*1.2));",
    "  col+=vec3(1.0,0.5,0.2)*pow(up,6.0)*0.08*uLight;",
    "  float cr=fbm(vec2(ax*0.03+seed*3.0,s*1.4+seed));",
    "  float cracks=smoothstep(0.6,0.66,cr)*(1.0-smoothstep(0.66,0.74,cr));",
    "  float spots=smoothstep(0.66,0.82,fbm(vec2(ax*0.08,s*2.5+uTime*0.12)+seed*5.0));",
    "  float pulse=0.55+0.45*vnoise(vec2(ax*0.04,uTime*1.3+seed*7.0));",
    "  float hot=smoothstep(0.18,0.7,heat);",
    "  col+=vec3(1.7,0.45,0.06)*(cracks*1.4+spots*0.8)*hot*pulse*uLight;",
    "  return vec4(col*m,m); }",
    "vec4 stone(vec2 p, vec2 c, float r, float seed, float facing){",
    "  vec2 q=(p-c)/vec2(r*1.3,r*0.78); float ang=atan(q.y,q.x);",
    "  float rr=1.0+0.12*sin(ang*3.0+seed*6.0)+0.06*sin(ang*5.0+seed*3.0);",
    "  float d=length(q)-rr; float aa=1.5/(uFW*r);",
    "  float m=smoothstep(aa,-aa,d); if(m<=0.0) return vec4(0.0);",
    "  float tex=fbm(p*vec2(60.0,90.0)+seed*9.0);",
    "  float top=smoothstep(-0.6,0.9,q.y);",
    "  vec3 col=vec3(0.06,0.06,0.065)*(0.55+tex*0.6)*(0.6+0.4*top);",
    "  col+=vec3(1.0,0.42,0.14)*uLight*(facing*0.35+top*0.25)*(0.5+tex*0.5)*0.55;",
    "  col*=smoothstep(-1.1,-0.4,q.y)*0.5+0.5;",
    "  return vec4(col*m,m); }",
    "void main(){",
    "  vec2 p=(vUv*uSize-vec2(uSize.x*0.5,uSize.y*0.22))/uFW;",
    "  vec4 o=vec4(0.0);",
    "  if(uFront<0.5){",
    "    for(int i=0;i<5;i++){ float fi=float(i); float th=0.35+fi*0.6; vec2 c=vec2(cos(th)*0.6,sin(th)*0.1+0.03); o=over(o,stone(p,c,0.075+0.015*fract(fi*0.618),fi+1.0,0.9)); }",
    "    vec2 q=(p-vec2(0.0,0.03))/vec2(0.44,0.07); float e=length(q);",
    "    float cm=smoothstep(1.0,0.75,e+0.15*(fbm(p*14.0)-0.5));",
    "    if(cm>0.0){ float g1=fbm(p*vec2(26.0,40.0)+vec2(0.0,uTime*0.08)); float g2=vnoise(p*vec2(55.0,70.0)+uTime*0.6);",
    "      float glow=smoothstep(0.42,0.72,g1)*(0.5+0.5*g2)*(1.0-e*0.6);",
    "      vec3 cc=vec3(0.025,0.018,0.014)+vec3(1.6,0.38,0.05)*glow*uLight*1.1+vec3(0.5,0.08,0.0)*(1.0-e)*0.25*uLight;",
    "      o=over(o,vec4(cc*cm,cm)); }",
    "    o=over(o,logC(p,vec2(-0.52,0.0),vec2(0.12,0.36),0.058,1.3));",
    "    o=over(o,logC(p,vec2(0.54,0.02),vec2(-0.1,0.38),0.06,2.7));",
    "  } else {",
    "    o=over(o,logC(p,vec2(-0.47,-0.04),vec2(0.45,0.07),0.066,4.1));",
    "    for(int i=0;i<6;i++){ float fi=float(i); float th=3.55+fi*0.47; vec2 c=vec2(cos(th)*0.66,sin(th)*0.13-0.02); o=over(o,stone(p,c,0.085+0.02*fract(fi*0.73),fi+11.0,0.5)); }",
    "  }",
    "  gl_FragColor=vec4(o.rgb*0.5,o.a);",
    "}"
  ].join("\n");

  var F_FIRE = [
    "uniform float uTime; uniform float uIntensity; uniform float uSeed; uniform float uGain; uniform float uWidthK; uniform float uSpeed; uniform float uRed;",
    "varying vec2 vUv;",
    NOISE,
    "void main(){",
    "  vec2 q=vec2((vUv.x-0.5)*2.0,vUv.y);",
    "  float I=uIntensity;",
    "  float y=q.y/(0.74+0.26*I);",
    "  float t=uTime*uSpeed+uSeed*13.0;",
    "  vec2 p=vec2(q.x*2.1,y*2.5-t*1.85);",
    "  vec2 w=vec2(fbm3(p*0.8+vec2(uSeed,-t*0.35)),fbm3(p*0.8+vec2(4.7+uSeed,1.3-t*0.3)));",
    "  float n=fbm(p+(w-0.5)*2.4);",
    "  float lick=fbm3(vec2(q.x*5.0+uSeed*3.0,y*3.2-t*3.1));",
    "  float sway=(w.x-0.5)*0.6*y*y+sin(t*0.8+y*2.2)*0.035*y;",
    "  float width=uWidthK*(0.6*pow(max(0.0,1.0-y),0.85)+0.03);",
    "  float dx=abs(q.x+sway);",
    "  float shape=1.0-smoothstep(width*0.2,width,dx);",
    "  float heat=shape*(1.22-y*1.02);",
    "  float env=1.0-smoothstep(width*0.9,width*1.7+0.1,dx);",
    "  float f=heat*1.45+(n-0.5)*1.7*(0.6+0.6*y)+(lick-0.5)*0.9*y-0.45;",
    "  f=f*env-(1.0-env)*0.6;",
    "  float E=smoothstep(0.0,0.06,q.y)*(1.0-smoothstep(0.78,0.98,q.y))*(1.0-smoothstep(0.8,0.98,abs(q.x)));",
    "  f=f*E-(1.0-E)*0.6;",
    "  f*=uGain*(0.85+0.15*I);",
    "  float a1=smoothstep(0.0,0.2,f);",
    "  vec3 c=vec3(0.75,0.1,0.01)*a1;",
    "  c+=vec3(0.32,0.24,0.015)*smoothstep(0.12,0.5,f);",
    "  c+=vec3(0.08,0.26,0.07)*smoothstep(0.45,0.95,f);",
    "  c+=vec3(0.02,0.06,0.12)*smoothstep(0.95,1.5,f);",
    "  c*=1.0+smoothstep(0.35,1.4,f)*1.1;",
    "  c+=vec3(0.16,0.018,0.0)*smoothstep(-0.18,0.0,f)*(1.0-a1)*0.5*env*E;",
    "  c+=vec3(0.04,0.09,0.32)*(1.0-smoothstep(0.0,0.12,y))*shape*0.55*smoothstep(0.0,0.03,q.y);",
    "  c*=mix(vec3(1.0),vec3(1.0,0.62,0.5),uRed);",
    "  gl_FragColor=vec4(c*0.5,1.0);",
    "}"
  ].join("\n");

  var F_SMOKE = [
    "uniform float uTime; uniform float uSmoke;",
    "varying vec2 vUv;",
    NOISE,
    "void main(){",
    "  vec2 q=vec2((vUv.x-0.5)*2.0,vUv.y); float t=uTime;",
    "  float spread=0.16+q.y*0.85;",
    "  float drift=q.y*q.y*0.4+sin(t*0.21+q.y*2.0)*0.05*q.y;",
    "  vec2 p=vec2((q.x-drift)/spread*0.9,q.y*3.2-t*0.32);",
    "  float n=fbm(p+vec2(fbm3(p*1.3+t*0.07),0.0)*0.9);",
    "  float colm=exp(-pow((q.x-drift)/spread,2.0)*2.2);",
    "  float a=smoothstep(0.4,0.85,n)*colm*smoothstep(0.0,0.1,q.y)*(1.0-smoothstep(0.4,1.0,q.y))*0.2*uSmoke;",
    "  vec3 c=mix(vec3(0.34,0.17,0.1),vec3(0.1,0.11,0.14),smoothstep(0.0,0.3,q.y));",
    "  gl_FragColor=vec4(c*a*0.5,a);",
    "}"
  ].join("\n");

  var V_SPARK = [
    "attribute float aSeed; attribute float aSpeed; attribute float aOffset; attribute float aBurst;",
    "uniform float uTime; uniform vec2 uBase; uniform float uFW; uniform float uFH; uniform float uBurstStart; uniform float uIntensity;",
    "varying vec2 vQ; varying float vLife; varying float vSeed;",
    "vec2 path(float life, float s, float b){",
    "  float up=uFH*(0.12+life*(1.25+s*1.1+b*0.9));",
    "  float x=(s-0.5)*uFW*(0.5+b*0.9)*(1.0+life*0.6*b)",
    "        +sin(life*7.0+s*40.0)*12.0*life+sin(uTime*1.1+s*17.0)*7.0*life",
    "        +life*life*uFW*0.35*(fract(s*7.31)-0.35);",
    "  return vec2(x,up); }",
    "void main(){",
    "  float life; float vis=1.0;",
    "  if(aBurst>0.5){ life=(uTime-uBurstStart)*aSpeed*1.5; vis=step(0.0,life)*step(life,1.0); }",
    "  else { life=fract(uTime*aSpeed+aOffset); }",
    "  life=clamp(life,0.0,1.0);",
    "  vec2 p0=path(life,aSeed,aBurst); vec2 p1=path(min(life+0.012,1.0),aSeed,aBurst);",
    "  vec2 v=p1-p0; float sp=length(v); vec2 dir=sp>0.001?v/sp:vec2(0.0,1.0); vec2 nrm=vec2(-dir.y,dir.x);",
    "  float len=clamp(sp*2.6,2.5,16.0); float wid=1.3+aSeed*1.6;",
    "  vec2 wpos=uBase+p0+dir*position.y*len+nrm*position.x*wid;",
    "  vQ=position.xy*2.0; vLife=life; vSeed=aSeed;",
    "  gl_Position=projectionMatrix*viewMatrix*vec4(wpos*vis,0.0,1.0);",
    "}"
  ].join("\n");
  var F_SPARK = [
    "varying vec2 vQ; varying float vLife; varying float vSeed;",
    "void main(){",
    "  float a=exp(-vQ.x*vQ.x*2.5)*exp(-vQ.y*vQ.y*1.6);",
    "  float fade=smoothstep(0.0,0.06,vLife)*(1.0-smoothstep(0.45,1.0,vLife));",
    "  float tw=0.55+0.45*sin(vLife*55.0+vSeed*90.0);",
    "  vec3 col=mix(vec3(1.6,1.05,0.5),vec3(1.3,0.28,0.03),smoothstep(0.0,0.7,vLife));",
    "  gl_FragColor=vec4(col*a*fade*tw*0.5,1.0);",
    "}"
  ].join("\n");

  var V_PAPER = [
    "uniform float uProgress; uniform float uTime; uniform float uFlutter; uniform float uSeed;",
    "varying vec2 vUv; varying float vCurl;",
    NOISE,
    "float metric(vec2 uv){ return uv.y*0.55+fbm(uv*vec2(2.6,3.2)+uSeed)*0.45; }",
    "void main(){",
    "  vUv=uv; vec3 pos=position;",
    "  float edge=uProgress*1.12-0.06;",
    "  float dist=metric(uv)-edge;",
    "  float curl=(1.0-smoothstep(0.0,0.24,dist))*step(0.001,uProgress);",
    "  pos.y+=curl*0.07;",
    "  pos.x*=1.0-curl*0.1;",
    "  pos.xy+=(vec2(vnoise(uv*7.0+uTime*0.8),vnoise(uv*7.0+3.1+uTime*0.8))-0.5)*curl*0.06;",
    "  pos.y+=sin(pos.x*3.5+uTime*6.0)*0.018*uFlutter;",
    "  pos.x+=sin(pos.y*4.0+uTime*4.3)*0.008*uFlutter;",
    "  vCurl=curl;",
    "  gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);",
    "}"
  ].join("\n");
  var F_PAPER = [
    "uniform sampler2D uMap; uniform float uProgress; uniform float uTime; uniform float uSeed; uniform float uWarm; uniform float uOpacity;",
    "varying vec2 vUv; varying float vCurl;",
    NOISE,
    "float metric(vec2 uv){ return uv.y*0.55+fbm(uv*vec2(2.6,3.2)+uSeed)*0.45; }",
    "void main(){",
    "  vec4 tex=texture2D(uMap,vUv);",
    "  float edge=uProgress*1.12-0.06;",
    "  float dist=metric(vUv)-edge+(fbm(vUv*28.0+uSeed)-0.5)*0.025;",
    "  if(uProgress>0.0 && dist<0.0) discard;",
    "  float on=step(0.001,uProgress);",
    "  float glow=(1.0-smoothstep(0.0,0.018,dist))*on;",
    "  float charr=(1.0-smoothstep(0.012,0.09,dist))*on;",
    "  float scorch=(1.0-smoothstep(0.05,0.2,dist))*on;",
    "  float crease=1.0-0.12*smoothstep(0.03,0.0,abs(fbm(vUv*vec2(3.0,4.0)+uSeed*2.0)-0.5));",
    "  vec3 c=tex.rgb*crease*(1.0-vCurl*0.35);",
    "  c=mix(c,c*vec3(0.62,0.42,0.22),scorch*0.85);",
    "  c=mix(c,vec3(0.03,0.022,0.018),charr);",
    "  float spark=step(0.86,vnoise(vUv*90.0+uTime*3.0));",
    "  c+=vec3(1.8,0.55,0.08)*glow*(1.1+spark*1.2);",
    "  c+=vec3(1.0,0.45,0.12)*uWarm*(1.0-vUv.y)*0.35;",
    "  float a=tex.a*uOpacity;",
    "  gl_FragColor=vec4(c*a*0.5,a);",
    "}"
  ].join("\n");

  var V_ASH = [
    "attribute float aSize; attribute float aRot; attribute float aTumble; attribute float aLife; attribute float aGlow;",
    "uniform float uPR;",
    "varying float vRot; varying float vTumble; varying float vLife; varying float vGlow;",
    "void main(){ vRot=aRot; vTumble=aTumble; vLife=aLife; vGlow=aGlow;",
    "  gl_PointSize=aLife>=0.0?aSize*uPR:0.0;",
    "  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }"
  ].join("\n");
  var F_ASH = [
    "varying float vRot; varying float vTumble; varying float vLife; varying float vGlow;",
    "void main(){",
    "  if(vLife<0.0) discard;",
    "  vec2 c=gl_PointCoord-0.5; float ca=cos(vRot); float sa=sin(vRot); c=mat2(ca,-sa,sa,ca)*c;",
    "  c.x/=max(0.18,abs(cos(vTumble)));",
    "  float ang=atan(c.y,c.x); float r=0.3+0.1*sin(ang*3.0+vRot*5.0)+0.05*sin(ang*7.0+vRot);",
    "  float d=length(c); float m=smoothstep(r,r-0.06,d);",
    "  float edge=smoothstep(r-0.16,r,d);",
    "  vec3 col=mix(vec3(0.12,0.11,0.1),vec3(1.8,0.55,0.08),vGlow*(0.3+edge*0.7));",
    "  float fade=smoothstep(0.0,0.08,vLife)*(1.0-smoothstep(0.6,1.0,vLife));",
    "  float a=m*fade;",
    "  gl_FragColor=vec4(col*a*0.5,a);",
    "}"
  ].join("\n");

  var F_BRIGHT = "uniform sampler2D uTex; varying vec2 vUv; void main(){ vec3 c=texture2D(uTex,vUv).rgb*2.0; vec3 b=max(c-0.9,0.0); gl_FragColor=vec4(b*0.5,1.0); }";
  var F_BLUR = [
    "uniform sampler2D uTex; uniform vec2 uDir; varying vec2 vUv;",
    "void main(){ vec3 c=texture2D(uTex,vUv).rgb*0.227;",
    "  c+=texture2D(uTex,vUv+uDir*1.385).rgb*0.316; c+=texture2D(uTex,vUv-uDir*1.385).rgb*0.316;",
    "  c+=texture2D(uTex,vUv+uDir*3.231).rgb*0.07; c+=texture2D(uTex,vUv-uDir*3.231).rgb*0.07;",
    "  gl_FragColor=vec4(c,1.0); }"
  ].join("\n");
  var F_FINAL = [
    "uniform sampler2D uScene; uniform sampler2D uBloomA; uniform sampler2D uBloomB;",
    "uniform vec2 uCss; uniform vec2 uFire; uniform float uFW; uniform float uFH; uniform float uTime; uniform float uHaze; uniform float uDim;",
    "varying vec2 vUv;",
    NOISE,
    "float tm(float x){ return x<0.62?x:0.62+0.38*(1.0-exp(-(x-0.62)/0.38)); }",
    "void main(){",
    "  vec2 uv=vUv; vec2 px=uv*uCss;",
    "  float hx=(px.x-uFire.x)/(uFW*0.6); float y0=uFire.y+uFH*0.55;",
    "  float mask=exp(-hx*hx)*smoothstep(y0-uFH*0.3,y0+uFH*0.15,px.y)*(1.0-smoothstep(y0+uFH*0.5,y0+uFH*1.5,px.y));",
    "  vec2 off=vec2(vnoise(px*vec2(0.05,0.028)-vec2(0.0,uTime*3.2))-0.5,vnoise(px*vec2(0.03,0.05)+7.0-vec2(0.0,uTime*2.7))-0.5);",
    "  uv+=off*mask*vec2(5.0,3.5)*uHaze/uCss;",
    "  vec3 c=texture2D(uScene,uv).rgb*2.0;",
    "  vec3 bl=(texture2D(uBloomA,uv).rgb*0.8+texture2D(uBloomB,uv).rgb*1.2)*2.0;",
    "  c+=bl*0.42;",
    "  c=vec3(tm(c.r),tm(c.g),tm(c.b));",
    "  vec2 v=vUv-0.5; c*=1.0-dot(v,v)*0.6;",
    "  c*=1.0-uDim;",
    "  c+=(hash12(gl_FragCoord.xy+fract(uTime*7.0)*311.0)-0.5)*0.028;",
    "  gl_FragColor=vec4(c,1.0);",
    "}"
  ].join("\n");

  function flickerAt(t) {
    return 0.86 + 0.07 * Math.sin(t * 6.1) + 0.05 * Math.sin(t * 11.7 + 1.2) + 0.03 * Math.sin(t * 23.3 + 0.4);
  }

  function lowEndDevice() {
    var mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
    return mem <= 2 || cores <= 2;
  }

  function create(canvas, opts) {
    opts = opts || {};
    var THREE = window.THREE;
    var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var api = {
      ok: false, canvas: canvas, layout: opts.layout || "hero",
      onFlicker: null, onFirstFrame: null
    };
    if (!THREE || !canvas) return fallback(api);

    var L = {}, R = {}, pr = 1, running = false, visible = true, raf = 0;
    var U = {
      time: { value: 0 }, intensity: { value: 1 }, light: { value: 1 }, burstStart: { value: -100 },
      smoke: { value: 1 }, haze: { value: 1 }, dim: { value: opts.dim || 0 }
    };
    var clock = 0, last = 0, frames = 0, slowSum = 0, firstFrameDone = false, tickers = [];

    function layout() {
      var W = Math.max(1, canvas.clientWidth || innerWidth), H = Math.max(1, canvas.clientHeight || innerHeight);
      var wide = W >= 900, center = api.layout === "center";
      L.W = W; L.H = H; L.wide = wide;
      L.horizon = H * (wide ? 0.25 : 0.2);
      L.fireX = center ? W * 0.5 : (wide ? W * 0.7 : W * 0.5);
      L.fw = wide ? Math.min(W * (center ? 0.22 : 0.18), center ? 320 : 270) : Math.min(W * 0.5, 210);
      L.fh = Math.min(L.fw * 1.7, H * (wide ? 0.4 : 0.3));
      L.baseY = L.horizon * 0.42;
      L.mH = wide ? Math.min(H * 0.3, W * 0.2) : Math.min(W * 0.42, H * 0.24);
      L.mX = wide ? (center ? W * 0.3 : W * 0.5) : W * 0.24;
      L.sX = wide ? L.mX + L.mH * 2.3 : W * 0.86;
      L.sH = L.mH * 0.6;
      L.moonX = W * (wide ? 0.84 : 0.86); L.moonY = H * (wide ? 0.82 : 0.56); L.moonR = wide ? 11 : 7;
    }

    function addBlend(m) { m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; m.blendEquation = THREE.AddEquation; return m; }
    function overBlend(m) { m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendEquation = THREE.AddEquation; return m; }
    function mat(v, f, uniforms) { return new THREE.ShaderMaterial({ vertexShader: v, fragmentShader: f, uniforms: uniforms, transparent: true, depthTest: false, depthWrite: false }); }
    function screenQuad(material) { var m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); m.frustumCulled = false; return m; }
    function makeRT(w, h) {
      return new THREE.WebGLRenderTarget(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: R.rtType, depthBuffer: false, stencilBuffer: false
      });
    }

    function init() {
      try {
        R.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
      } catch (e) { return false; }
      var r = R.renderer;
      r.autoClear = false;
      var gl2 = r.capabilities.isWebGL2;
      R.rtType = (gl2 && (r.extensions.has("EXT_color_buffer_float") || r.extensions.has("EXT_color_buffer_half_float"))) ? THREE.HalfFloatType : THREE.UnsignedByteType;
      var dpr = window.devicePixelRatio || 1;
      pr = lowEndDevice() ? 1 : Math.min(dpr, innerWidth < 700 ? 1.5 : 1.25);
      if (opts.pixelRatio) pr = opts.pixelRatio;

      R.cam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
      R.scene = new THREE.Scene();
      R.bgU = { uRes: { value: new THREE.Vector2() }, uPR: { value: 1 }, uHorizon: { value: 0 }, uMX: { value: 0 }, uMH: { value: 0 }, uSX: { value: 0 }, uSH: { value: 0 }, uMoon: { value: new THREE.Vector3() } };
      R.bgScene = new THREE.Scene();
      R.bgScene.add(screenQuad(new THREE.ShaderMaterial({ vertexShader: V_SCREEN, fragmentShader: F_BG, uniforms: R.bgU, depthTest: false, depthWrite: false })));
      R.copyU = { uBg: { value: null }, uRes: { value: new THREE.Vector2() }, uPR: { value: 1 }, uFire: { value: new THREE.Vector2() }, uFW: { value: 1 }, uLight: U.light, uHorizon: { value: 0 } };
      var bgq = screenQuad(new THREE.ShaderMaterial({ vertexShader: V_SCREEN, fragmentShader: F_BGCOPY, uniforms: R.copyU, depthTest: false, depthWrite: false }));
      bgq.renderOrder = 0; R.scene.add(bgq);

      function hearth(front) {
        var u = { uTime: U.time, uLight: U.light, uFW: { value: 1 }, uSize: { value: new THREE.Vector2() }, uFront: { value: front } };
        var m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overBlend(mat(V_OBJ, F_HEARTH, u)));
        m.userData.u = u; return m;
      }
      R.hBack = hearth(0); R.hBack.renderOrder = 1; R.scene.add(R.hBack);
      R.hFront = hearth(1); R.hFront.renderOrder = 4; R.scene.add(R.hFront);
      function fire(seed, gain, widthK, speed, red) {
        var u = { uTime: U.time, uIntensity: U.intensity, uSeed: { value: seed }, uGain: { value: gain }, uWidthK: { value: widthK }, uSpeed: { value: speed }, uRed: { value: red } };
        return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addBlend(mat(V_OBJ, F_FIRE, u)));
      }
      R.fBack = fire(3.7, 0.72, 1.25, 0.82, 0.7); R.fBack.renderOrder = 2; R.scene.add(R.fBack);
      R.fMain = fire(0.0, 1.0, 0.88, 1.0, 0.0); R.fMain.renderOrder = 3; R.scene.add(R.fMain);
      R.fSideL = fire(11.1, 0.85, 1.0, 1.15, 0.25); R.fSideL.renderOrder = 3; R.scene.add(R.fSideL);
      R.fSideR = fire(19.4, 0.8, 1.0, 1.08, 0.3); R.fSideR.renderOrder = 3; R.scene.add(R.fSideR);
      R.fFront = fire(7.3, 0.62, 0.78, 1.22, 0.15); R.fFront.renderOrder = 6; R.scene.add(R.fFront);
      R.smoke = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overBlend(mat(V_OBJ, F_SMOKE, { uTime: U.time, uSmoke: U.smoke })));
      R.smoke.renderOrder = 7; R.scene.add(R.smoke);

      var base = new THREE.PlaneGeometry(1, 1);
      var sg = new THREE.InstancedBufferGeometry();
      sg.index = base.index; sg.setAttribute("position", base.getAttribute("position"));
      var small = innerWidth < 700 || lowEndDevice();
      var nNorm = small ? 60 : 120, nBurst = small ? 60 : 100, N = nNorm + nBurst;
      var aSeed = new Float32Array(N), aSpeed = new Float32Array(N), aOff = new Float32Array(N), aBurst = new Float32Array(N);
      for (var i = 0; i < N; i++) {
        aSeed[i] = Math.random(); aOff[i] = Math.random(); aBurst[i] = i >= nNorm ? 1 : 0;
        aSpeed[i] = aBurst[i] ? 0.3 + Math.random() * 0.45 : 0.1 + Math.random() * 0.2;
      }
      sg.setAttribute("aSeed", new THREE.InstancedBufferAttribute(aSeed, 1));
      sg.setAttribute("aSpeed", new THREE.InstancedBufferAttribute(aSpeed, 1));
      sg.setAttribute("aOffset", new THREE.InstancedBufferAttribute(aOff, 1));
      sg.setAttribute("aBurst", new THREE.InstancedBufferAttribute(aBurst, 1));
      sg.instanceCount = N;
      R.sparkU = { uTime: U.time, uBase: { value: new THREE.Vector2() }, uFW: { value: 1 }, uFH: { value: 1 }, uBurstStart: U.burstStart, uIntensity: U.intensity };
      R.sparks = new THREE.Mesh(sg, addBlend(mat(V_SPARK, F_SPARK, R.sparkU)));
      R.sparks.frustumCulled = false; R.sparks.renderOrder = 8; R.scene.add(R.sparks);

      R.ashN = 200;
      var ag = new THREE.BufferGeometry();
      R.ash = {
        pos: new Float32Array(R.ashN * 3), size: new Float32Array(R.ashN), rot: new Float32Array(R.ashN), tumble: new Float32Array(R.ashN),
        life: new Float32Array(R.ashN).fill(-1), glow: new Float32Array(R.ashN), vx: new Float32Array(R.ashN), vy: new Float32Array(R.ashN),
        spin: new Float32Array(R.ashN), tspin: new Float32Array(R.ashN), dur: new Float32Array(R.ashN), next: 0, active: 0
      };
      ag.setAttribute("position", new THREE.BufferAttribute(R.ash.pos, 3));
      ag.setAttribute("aSize", new THREE.BufferAttribute(R.ash.size, 1));
      ag.setAttribute("aRot", new THREE.BufferAttribute(R.ash.rot, 1));
      ag.setAttribute("aTumble", new THREE.BufferAttribute(R.ash.tumble, 1));
      ag.setAttribute("aLife", new THREE.BufferAttribute(R.ash.life, 1));
      ag.setAttribute("aGlow", new THREE.BufferAttribute(R.ash.glow, 1));
      R.ashU = { uPR: { value: 1 } };
      R.ashPts = new THREE.Points(ag, overBlend(mat(V_ASH, F_ASH, R.ashU)));
      R.ashPts.frustumCulled = false; R.ashPts.renderOrder = 9; R.scene.add(R.ashPts);

      R.brightM = new THREE.ShaderMaterial({ vertexShader: V_SCREEN, fragmentShader: F_BRIGHT, uniforms: { uTex: { value: null } }, depthTest: false, depthWrite: false });
      R.blurM = new THREE.ShaderMaterial({ vertexShader: V_SCREEN, fragmentShader: F_BLUR, uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
      R.finalU = { uScene: { value: null }, uBloomA: { value: null }, uBloomB: { value: null }, uCss: { value: new THREE.Vector2() }, uFire: { value: new THREE.Vector2() }, uFW: { value: 1 }, uFH: { value: 1 }, uTime: U.time, uHaze: U.haze, uDim: U.dim };
      R.finalM = new THREE.ShaderMaterial({ vertexShader: V_SCREEN, fragmentShader: F_FINAL, uniforms: R.finalU, depthTest: false, depthWrite: false });
      R.postScene = new THREE.Scene(); R.postQuad = screenQuad(R.brightM); R.postScene.add(R.postQuad);

      canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); stop(); api.ok = false; fallback(api); }, false);
      return true;
    }

    function postPass(material, target) {
      R.postQuad.material = material;
      R.renderer.setRenderTarget(target);
      R.renderer.render(R.postScene, R.cam);
    }

    function size() {
      layout();
      var r = R.renderer, W = L.W, H = L.H;
      r.setPixelRatio(1);
      r.setSize(Math.round(W * pr), Math.round(H * pr), false);
      ["sceneRT", "bgRT", "a1", "a2", "b1", "b2"].forEach(function (k) { if (R[k]) R[k].dispose(); });
      R.sceneRT = makeRT(W * pr, H * pr); R.bgRT = makeRT(W * pr, H * pr);
      R.a1 = makeRT(W * pr / 4, H * pr / 4); R.a2 = makeRT(W * pr / 4, H * pr / 4);
      R.b1 = makeRT(W * pr / 8, H * pr / 8); R.b2 = makeRT(W * pr / 8, H * pr / 8);
      R.cam.left = 0; R.cam.right = W; R.cam.top = H; R.cam.bottom = 0; R.cam.updateProjectionMatrix();
      var u = R.bgU;
      u.uRes.value.set(W, H); u.uPR.value = pr; u.uHorizon.value = L.horizon;
      u.uMX.value = L.mX; u.uMH.value = L.mH; u.uSX.value = L.sX; u.uSH.value = L.sH; u.uMoon.value.set(L.moonX, L.moonY, L.moonR);
      r.setRenderTarget(R.bgRT); r.render(R.bgScene, R.cam);
      var c = R.copyU;
      c.uBg.value = R.bgRT.texture; c.uRes.value.set(W, H); c.uPR.value = pr; c.uFire.value.set(L.fireX, L.baseY); c.uFW.value = L.fw; c.uHorizon.value = L.horizon;
      var fw = L.fw, fh = L.fh, bx = L.fireX, by = L.baseY;
      [R.hBack, R.hFront].forEach(function (m) {
        var w = fw * 1.55, h = fw * 0.62;
        m.scale.set(w, h, 1); m.position.set(bx, by - h * 0.22 + h / 2, 0);
        m.userData.u.uFW.value = fw; m.userData.u.uSize.value.set(w, h);
      });
      R.fBack.scale.set(fw * 1.25, fh * 1.04, 1); R.fBack.position.set(bx + fw * 0.02, by + fh * 0.52 + fw * 0.01, 0);
      R.fMain.scale.set(fw, fh, 1); R.fMain.position.set(bx, by + fh * 0.5 + fw * 0.03, 0);
      R.fSideL.scale.set(fw * 0.55, fh * 0.5, 1); R.fSideL.position.set(bx - fw * 0.24, by + fh * 0.25 + fw * 0.05, 0);
      R.fSideR.scale.set(fw * 0.5, fh * 0.42, 1); R.fSideR.position.set(bx + fw * 0.26, by + fh * 0.21 + fw * 0.06, 0);
      R.fFront.scale.set(fw * 0.88, fh * 0.6, 1); R.fFront.position.set(bx - fw * 0.03, by + fh * 0.3 + fw * 0.02, 0);
      var sh = H * 0.62; R.smoke.scale.set(fw * 2.2, sh, 1); R.smoke.position.set(bx, by + fh * 0.6 + sh / 2, 0);
      R.sparkU.uBase.value.set(bx, by); R.sparkU.uFW.value = fw; R.sparkU.uFH.value = fh;
      R.ashU.uPR.value = pr;
      var f = R.finalU; f.uCss.value.set(W, H); f.uFire.value.set(bx, by); f.uFW.value = fw; f.uFH.value = fh;
    }

    function renderFrame() {
      var r = R.renderer;
      r.setRenderTarget(R.sceneRT); r.clear();
      r.render(R.scene, R.cam);
      R.brightM.uniforms.uTex.value = R.sceneRT.texture; postPass(R.brightM, R.a1);
      var bm = R.blurM.uniforms;
      bm.uTex.value = R.a1.texture; bm.uDir.value.set(1 / R.a1.width, 0); postPass(R.blurM, R.a2);
      bm.uTex.value = R.a2.texture; bm.uDir.value.set(0, 1 / R.a1.height); postPass(R.blurM, R.a1);
      bm.uTex.value = R.a1.texture; bm.uDir.value.set(1.5 / R.b1.width, 0); postPass(R.blurM, R.b1);
      bm.uTex.value = R.b1.texture; bm.uDir.value.set(0, 1.5 / R.b1.height); postPass(R.blurM, R.b2);
      R.finalU.uScene.value = R.sceneRT.texture; R.finalU.uBloomA.value = R.a1.texture; R.finalU.uBloomB.value = R.b2.texture;
      postPass(R.finalM, null);
    }

    function spawnAsh(x, y, glow) {
      var a = R.ash, i = a.next; a.next = (a.next + 1) % R.ashN;
      a.pos[i * 3] = x; a.pos[i * 3 + 1] = y; a.pos[i * 3 + 2] = 0;
      a.vx[i] = (Math.random() - 0.5) * 30; a.vy[i] = 25 + Math.random() * 45;
      a.size[i] = 3 + Math.random() * 6; a.rot[i] = Math.random() * 6.28; a.tumble[i] = Math.random() * 6.28;
      a.spin[i] = (Math.random() - 0.5) * 4; a.tspin[i] = 2 + Math.random() * 5;
      a.dur[i] = 1.8 + Math.random() * 2.2; a.life[i] = 0; a.glow[i] = glow;
    }
    function stepAsh(dt, t) {
      var a = R.ash, any = false;
      for (var i = 0; i < R.ashN; i++) {
        if (a.life[i] < 0) continue;
        any = true;
        a.life[i] += dt / a.dur[i];
        if (a.life[i] >= 1) { a.life[i] = -1; continue; }
        a.vy[i] += 18 * dt; a.vy[i] *= 0.995;
        a.vx[i] += (Math.sin(t * 1.7 + i * 1.3) * 22 + 8) * dt; a.vx[i] *= 0.985;
        a.pos[i * 3] += a.vx[i] * dt; a.pos[i * 3 + 1] += a.vy[i] * dt;
        a.rot[i] += a.spin[i] * dt; a.tumble[i] += a.tspin[i] * dt;
        a.glow[i] = Math.max(0, a.glow[i] - dt * 0.9);
      }
      if (any || a.active) {
        var g = R.ashPts.geometry;
        ["position", "aSize", "aRot", "aTumble", "aLife", "aGlow"].forEach(function (k) { g.getAttribute(k).needsUpdate = true; });
      }
      a.active = any;
    }

    function frame(now) {
      raf = 0;
      if (!running) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
      clock += dt * (reduceMotion ? 0.4 : 1);
      U.time.value = clock;
      U.light.value = flickerAt(clock) * (0.8 + 0.2 * U.intensity.value) * (1 + 0.25 * (U.intensity.value - 1));
      if (api.onFlicker) api.onFlicker(U.light.value);
      for (var i = 0; i < tickers.length; i++) tickers[i](dt);
      stepAsh(dt, clock);
      renderFrame();
      if (!firstFrameDone) { firstFrameDone = true; if (api.onFirstFrame) api.onFirstFrame(); }
      frames++;
      if (frames > 20 && frames <= 110) slowSum += dt;
      if (frames === 110 && slowSum / 90 > 0.03 && pr > 0.75) { pr = pr > 1 ? 1 : 0.75; size(); frames = 0; slowSum = 0; }
      raf = requestAnimationFrame(frame);
    }

    function start() { if (running || !visible) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

    if (!init()) return fallback(api);
    size();
    api.ok = true;

    // Pause when the canvas is off screen or the tab is hidden.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible && !document.hidden) start(); else stop();
      }, { threshold: 0.01 }).observe(canvas);
    }
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else if (visible) start(); });
    var resizeT;
    window.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () { size(); }, 150);
    });

    /* ---------- paper texture ---------- */
    function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n) || "serif"; }
    function wrapLines(ctx, text, maxW) {
      var words = text.replace(/\s+/g, " ").trim().split(" "), lines = [], line = "";
      words.forEach(function (w) {
        var test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
      });
      if (line) lines.push(line);
      return lines;
    }
    function paperTexture(text, w, h, gold) {
      var c = document.createElement("canvas"), S = 2;
      c.width = Math.round(w * S); c.height = Math.round(h * S);
      var ctx = c.getContext("2d"); ctx.scale(S, S);
      ctx.fillStyle = gold ? "#e9c77b" : "#efe4cf"; ctx.fillRect(0, 0, w, h);
      var g = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, w * 0.9);
      g.addColorStop(0, "rgba(255,255,255,.3)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 1400; i++) {
        ctx.fillStyle = "rgba(110,85,55," + (Math.random() * 0.05) + ")";
        ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 1.5, Math.random() * 4);
      }
      ctx.fillStyle = "#9b8466"; ctx.font = "500 13px " + cssVar("--serif");
      ctx.textAlign = "right"; ctx.fillText(String(opts.year || ""), w - 16, 24); ctx.textAlign = "left";
      ctx.fillStyle = "#2a1f16";
      var fs = Math.max(16, Math.min(24, w / 14));
      ctx.font = "600 " + fs + "px " + cssVar("--serif");
      wrapLines(ctx, text, w - 44).slice(0, 5).forEach(function (ln, idx) { ctx.fillText(ln, 22, 22 + fs + idx * fs * 1.35); });
      var tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
      return tex;
    }

    /* ---------- the burn ---------- */
    api.burnPaper = function (o) {
      o = o || {};
      start();
      return new Promise(function (resolve) {
        var gsap = window.gsap;
        var rect;
        if (o.fromEl) rect = o.fromEl.getBoundingClientRect();
        var cr0 = canvas.getBoundingClientRect();
        var pw = rect ? rect.width : Math.min(L.W * 0.8, 340), ph = rect ? rect.height : pw * 0.55;
        var cx = rect ? rect.left - cr0.left + pw / 2 : L.W / 2;
        var cy = rect ? L.H - (rect.top - cr0.top + ph / 2) : L.H * 0.62;
        if (!gsap || reduceMotion) {
          U.burstStart.value = clock; U.intensity.value = 1.4;
          if (o.onCatch) o.onCatch();
          setTimeout(function () { U.intensity.value = 1; resolve(); }, reduceMotion ? 900 : 1500);
          return;
        }
        var tex = paperTexture(o.text || "", pw, ph, false);
        var pu = { uMap: { value: tex }, uProgress: { value: 0 }, uTime: U.time, uFlutter: { value: 0 }, uSeed: { value: Math.random() * 10 }, uWarm: { value: 0 }, uOpacity: { value: 1 } };
        var pmat = overBlend(mat(V_PAPER, F_PAPER, pu));
        var paper = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 24, 30), pmat);
        paper.renderOrder = 5; paper.frustumCulled = false;
        paper.scale.set(pw, ph, 1); paper.position.set(cx, cy, 0); paper.rotation.z = (o.fromRotation || 1) * Math.PI / 180;
        R.scene.add(paper);
        if (o.onStart) o.onStart();

        var k = Math.min(1, (L.fw * 0.78) / pw);
        var hoverY = L.baseY + L.fh * 0.5;
        var ashAcc = 0, rise = { t: 0 };
        function tick(dt) {
          var p = pu.uProgress.value;
          if (p > 0.02 && p < 0.98) {
            ashAcc += dt * (40 + p * 50);
            var edge = p * 1.12 - 0.06;
            var vEdge = Math.max(0, Math.min(1, (edge - 0.225) / 0.55));
            var sx = paper.scale.x, sy = paper.scale.y, rz = paper.rotation.z, c = Math.cos(rz), s = Math.sin(rz);
            while (ashAcc > 1) {
              ashAcc -= 1;
              var u = Math.random() - 0.5, v = vEdge + (Math.random() - 0.5) * 0.18 - 0.5;
              var lx = u * sx, ly = v * sy;
              spawnAsh(paper.position.x + lx * c - ly * s, paper.position.y + lx * s + ly * c, Math.random() < 0.7 ? 1 : 0.3);
            }
          }
          pu.uWarm.value = Math.max(0, Math.min(1, 1 - (paper.position.y - hoverY) / (L.H * 0.4)));
        }
        tickers.push(tick);
        var tl = gsap.timeline({
          onComplete: function () {
            R.scene.remove(paper); paper.geometry.dispose(); pmat.dispose(); tex.dispose();
            tickers.splice(tickers.indexOf(tick), 1);
            resolve();
          }
        });
        tl.to(paper.position, { y: cy + 14, duration: 0.35, ease: "power2.out" }, 0)
          .to(pu.uFlutter, { value: 1, duration: 0.6 }, 0)
          .to(paper.position, { x: L.fireX, y: hoverY, duration: 1.2, ease: "power2.inOut" }, 0.35)
          .to(paper.scale, { x: pw * k, y: ph * k, duration: 1.2, ease: "power2.inOut" }, 0.35)
          .to(paper.rotation, { z: -0.16, duration: 1.2, ease: "sine.inOut" }, 0.35)
          .to(paper.rotation, { z: 0.06, duration: 0.8, ease: "sine.inOut" }, 1.55)
          .to(pu.uProgress, { value: 1, duration: 4.3, ease: "sine.in" }, 1.75)
          .to(U.smoke, { value: 2.2, duration: 1.2 }, 1.8)
          .to(U.intensity, { value: 1.45, duration: 0.7, ease: "power2.out" }, 1.9)
          .call(function () { U.burstStart.value = clock; if (o.onCatch) o.onCatch(); }, null, 2.3)
          .to(U.haze, { value: 1.8, duration: 0.8 }, 2.2)
          .to(rise, {
            t: 1, duration: 3.9, ease: "none",
            onUpdate: function () {
              var t = rise.t, e = t * (0.3 + 0.7 * t);
              paper.position.y = hoverY + (L.H * 0.97 - hoverY) * e;
              paper.position.x = L.fireX + Math.sin(t * 5.2) * L.fw * 0.28 * t + t * t * L.fw * 0.5;
              paper.rotation.z = 0.06 + Math.sin(t * 4.1 + 0.5) * 0.28 * t;
              var sc = 1 - 0.3 * t;
              paper.scale.set(pw * k * sc, ph * k * sc, 1);
            }
          }, 2.35)
          .to(U.intensity, { value: 1, duration: 1.8, ease: "power2.inOut" }, 3.4)
          .to(U.smoke, { value: 1, duration: 3.0 }, 4.2)
          .to(U.haze, { value: 1, duration: 1.5 }, 3.6)
          .to({}, { duration: 0.2 }, 6.1);
        api.currentTimeline = tl;
      });
    };

    // A short flare, e.g. when a paper from the shared feed lands in the fire.
    api.flare = function (strength) {
      U.burstStart.value = clock;
      if (window.gsap) {
        window.gsap.timeline()
          .to(U.intensity, { value: 1 + 0.35 * (strength || 1), duration: 0.5, ease: "power2.out" })
          .to(U.intensity, { value: 1, duration: 1.4, ease: "power2.inOut" });
      }
    };
    api.setDim = function (v, dur) {
      if (window.gsap && !reduceMotion) window.gsap.to(U.dim, { value: v, duration: dur == null ? 0.6 : dur });
      else U.dim.value = v;
    };
    api.fireCenter = function () { return { x: L.fireX, y: L.H - L.baseY - L.fh * 0.5 }; };

    // Story image (1080x1920) built from the live scene plus text.
    api.storyCanvas = function (draw) {
      var W = 1080, H = 1920;
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#04060d"; ctx.fillRect(0, 0, W, H);
      renderFrame();
      var src = R.renderer.domElement, s = src.width / L.W;
      var cropH = Math.min(L.H, L.W / 0.5625), cropW = cropH * 0.5625;
      var x0 = Math.max(0, Math.min(L.W - cropW, L.fireX - cropW / 2)), y0 = L.H - cropH;
      try { ctx.drawImage(src, x0 * s, y0 * s, cropW * s, cropH * s, 0, 0, W, H); } catch (e) { /* tainted or lost */ }
      if (draw) draw(ctx, W, H);
      return c;
    };

    api.start = start; api.stop = stop; api.resize = size;
    api.onFirstFrameSet = function (fn) { if (firstFrameDone) fn(); else api.onFirstFrame = fn; };
    start();
    return api;
  }

  function fallback(api) {
    api.ok = false;
    document.documentElement.classList.add("no-webgl");
    api.burnPaper = function (o) {
      return new Promise(function (resolve) {
        if (o && o.onStart) o.onStart();
        setTimeout(function () { if (o && o.onCatch) o.onCatch(); }, 300);
        setTimeout(resolve, 1400);
      });
    };
    api.flare = function () {};
    api.setDim = function () {};
    api.start = api.stop = api.resize = function () {};
    api.fireCenter = function () { return { x: innerWidth / 2, y: innerHeight * 0.7 }; };
    api.storyCanvas = function (draw) {
      var W = 1080, H = 1920, c = document.createElement("canvas"); c.width = W; c.height = H;
      var ctx = c.getContext("2d");
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#04060d"); g.addColorStop(0.6, "#121a33"); g.addColorStop(1, "#3a1c12");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var r = ctx.createRadialGradient(W / 2, H * 0.85, 0, W / 2, H * 0.85, W * 0.6);
      r.addColorStop(0, "rgba(255,140,50,.85)"); r.addColorStop(1, "rgba(255,90,30,0)");
      ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
      if (draw) draw(ctx, W, H);
      return c;
    };
    api.onFirstFrameSet = function (fn) { fn(); };
    return api;
  }

  /* ---------- fire sound: synthesized crackle, off by default ---------- */
  var Sound = {
    ctx: null, on: false,
    toggle: function () { return this.on ? (this.stop(), false) : (this.start(), true); },
    start: function () {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      var ac = this.ctx = new AC();
      var len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0), lst = 0;
      for (var i = 0; i < len; i++) { var w = Math.random() * 2 - 1; lst = (lst + 0.02 * w) / 1.02; d[i] = lst * 3.2; }
      this.buf = buf;
      var src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 650;
      var gain = this.gain = ac.createGain(); gain.gain.value = 0;
      src.connect(lp); lp.connect(gain); gain.connect(ac.destination); src.start();
      gain.gain.linearRampToValueAtTime(0.5, ac.currentTime + 1.2);
      var cbuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.03), ac.sampleRate), cd = cbuf.getChannelData(0);
      for (var j = 0; j < cd.length; j++) cd[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / cd.length, 6);
      var self = this; this.on = true;
      (function crackle() {
        if (!self.on || self.ctx !== ac) return;
        var s = ac.createBufferSource(); s.buffer = cbuf;
        var hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200 + Math.random() * 2500;
        var g2 = ac.createGain(); g2.gain.value = 0.06 + Math.random() * 0.22;
        s.connect(hp); hp.connect(g2); g2.connect(ac.destination); s.start();
        setTimeout(crackle, 40 + Math.random() * 420);
      })();
    },
    stop: function () {
      var ac = this.ctx; this.on = false; if (!ac) return;
      this.gain.gain.linearRampToValueAtTime(0, ac.currentTime + 0.4);
      setTimeout(function () { ac.close(); }, 500);
      this.ctx = null;
    },
    whoosh: function () {
      var ac = this.ctx; if (!ac || !this.on) return;
      var s = ac.createBufferSource(); s.buffer = this.buf;
      var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(200, ac.currentTime); bp.frequency.exponentialRampToValueAtTime(1400, ac.currentTime + 0.6);
      var g = ac.createGain(); g.gain.setValueAtTime(0, ac.currentTime);
      g.gain.linearRampToValueAtTime(1.3, ac.currentTime + 0.25); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.6);
      s.connect(bp); bp.connect(g); g.connect(ac.destination); s.start(); s.stop(ac.currentTime + 1.7);
    }
  };

  window.FireScene = { create: create, Sound: Sound };
})();
