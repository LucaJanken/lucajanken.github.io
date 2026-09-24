"""Download JPL Horizons state vectors used to validate and fit the model.

    python3 tests/fetch_horizons.py            # everything
    python3 tests/fetch_horizons.py 606 401    # just Titan and Phobos

Writes tests/horizons-full/<NAIF id>.json: rows of [JD(TDB), x, y, z, vx, vy, vz] in km and km/s,
ICRF (J2000 equatorial), geometric, every 37 days over 1800-2050. Planets are heliocentric, moons
relative to their planet. tests/fixtures/horizons.json is every 10th row of these (positions only).
Standard library only.
"""
import os
import urllib.request, urllib.parse, json, sys, re
def vectors(cmd, center, start, stop, step):
    q = {'format':'json','COMMAND':f"'{cmd}'",'CENTER':f"'{center}'",'EPHEM_TYPE':'VECTORS','REF_PLANE':'FRAME','REF_SYSTEM':'ICRF',
         'VEC_TABLE':'2','OUT_UNITS':'KM-S','CSV_FORMAT':'YES','OBJ_DATA':'NO','START_TIME':f"'{start}'",'STOP_TIME':f"'{stop}'",'STEP_SIZE':f"'{step}'"}
    url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(q)
    r = json.load(urllib.request.urlopen(url, timeout=120))['result']
    if '$$SOE' not in r: raise SystemExit(r[:2000])
    body = r.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()
    out = []
    for line in body:
        f = [x.strip() for x in line.split(',')]
        out.append([float(f[0])] + [float(x) for x in f[2:8]])   # JD(TDB), x,y,z,vx,vy,vz
    return out
jobs = {k:(k,'500@10') for k in ['199','299','399','499','599','699','799','899','999']}
jobs.update({'301':('301','500@399'),'501':('501','500@599'),'502':('502','500@599'),'503':('503','500@599'),'504':('504','500@599'),
             '606':('606','500@699'),'401':('401','500@499'),'402':('402','500@499')})
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'horizons-full')
os.makedirs(OUT, exist_ok=True)
which = sys.argv[1:] or list(jobs)
for k in which:
    cmd, c = jobs[k]
    data = vectors(cmd, c, '1800-01-03', '2050-12-31', '37 d')
    json.dump(data, open(os.path.join(OUT, f'{k}.json'), 'w'))
    print(k, len(data), data[0][0], data[-1][0])
