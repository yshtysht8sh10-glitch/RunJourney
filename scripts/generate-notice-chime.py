# Common notice only: 0.30s bright ascending triad, peak below existing stop PCM.
# Existing transition resources are deliberately left untouched.
import math, struct, wave
from pathlib import Path
samples=[]
for hz in [880.0,1108.73,1318.51]:
 for i in range(2200):
  env=min(1,i/150)*min(1,(2199-i)/550)
  samples.append(int(8500*env*math.sin(2*math.pi*hz*i/22000)))
p=Path(__file__).resolve().parents[1]/'modules/run-announcer/android/src/main/res/raw/run_notice.wav'
with wave.open(str(p),'wb') as out:
 out.setparams((1,2,22000,0,'NONE','not compressed'));out.writeframes(struct.pack('<'+'h'*len(samples),*samples))
