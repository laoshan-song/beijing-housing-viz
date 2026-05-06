import csv, json, random

DISTRICT_MAP = {
    '1':'东城','2':'丰台','3':'亦庄','4':'大兴','5':'房山',
    '6':'昌平','7':'朝阳','8':'海淀','9':'石景山','10':'西城',
    '11':'通州','12':'门头沟','13':'顺义'
}

rows_by_district = {}
with open('/home/laoshansong/price data/new.csv', encoding='gbk', errors='replace') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            price = float(row['price'])
            bt = row['buildingType'].strip()
            if not (5000 <= price <= 150000): continue
            if bt not in ('1','2','3','4'): continue
            d = row['district'].strip()
            if d not in DISTRICT_MAP: continue
            rows_by_district.setdefault(d, []).append({
                'lng': float(row['Lng']),
                'lat': float(row['Lat']),
                'price': int(price),
                'totalPrice': float(row['totalPrice']),
                'square': float(row['square']),
                'tradeTime': row['tradeTime'][:7],  # YYYY-MM
                'district': DISTRICT_MAP[d],
                'subway': int(float(row['subway'])) if row['subway'].strip() else 0,
                'elevator': int(float(row['elevator'])) if row['elevator'].strip() else 0,
                'renovation': int(float(row['renovationCondition'])) if row['renovationCondition'].strip() else 0,
                'buildingType': int(float(bt)),
                'builtYear': int(row['constructionTime'].strip()) if row['constructionTime'].strip().isdigit() else 0,
            })
        except (ValueError, KeyError):
            continue

# stratified sample ~5000 total
result = []
total = sum(len(v) for v in rows_by_district.values())
for d, rows in rows_by_district.items():
    n = max(1, round(len(rows) / total * 5000))
    result.extend(random.sample(rows, min(n, len(rows))))

random.shuffle(result)
with open('/home/laoshansong/beijing-housing-viz/data/housing.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False)

print(f"Done: {len(result)} records")
for d, rows in sorted(rows_by_district.items(), key=lambda x: int(x[0])):
    print(f"  {DISTRICT_MAP[d]}: {len(rows)} raw")
