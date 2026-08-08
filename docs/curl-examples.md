# Curl examples

Base URL local: `http://localhost:3000`  
Header: `X-API-Key: dev-key-local`

## Health

```bash
curl -s http://localhost:3000/health | jq
```

## Create order (mock)

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: dev-key-local' \
  -d '{
    "order_id": "ORD-DEMO-001",
    "courier_partner": "mock",
    "service_type": "NDD",
    "shipper": {
      "name": "Shipper Co",
      "phone": "9876543210",
      "address_line1": "Warehouse 1",
      "city": "Delhi",
      "state": "DL",
      "pincode": "110001",
      "country": "INDIA"
    },
    "consignee": {
      "name": "Buyer",
      "phone": "9123456780",
      "address_line1": "Home 12, Andheri West",
      "city": "Mumbai",
      "state": "MH",
      "pincode": "400001",
      "country": "INDIA"
    },
    "parcel": {
      "description": "Books",
      "quantity": 1,
      "weight_kg": 0.5,
      "length_cm": 10,
      "breadth_cm": 10,
      "height_cm": 10,
      "pieces": 1
    },
    "payment": {
      "mode": "PREPAID",
      "collectable_value": 0,
      "declared_value": 100,
      "invoice_number": "INV-001",
      "invoice_date": "2026-03-07",
      "invoice_value": 100
    }
  }' | jq
```

## Create order (delhivery mock)

Same unified body; partner uses Delhivery field mapping + waybill response internally.

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: dev-key-local' \
  -d '{
    "order_id": "ORD-DLV-001",
    "courier_partner": "delhivery",
    "service_type": "NDD",
    "shipper": {
      "name": "Shipper Co",
      "phone": "9876543210",
      "address_line1": "Warehouse 1",
      "city": "Delhi",
      "state": "DL",
      "pincode": "110001",
      "country": "INDIA"
    },
    "consignee": {
      "name": "Buyer",
      "phone": "9123456780",
      "address_line1": "Home 12, Andheri West",
      "city": "Mumbai",
      "state": "MH",
      "pincode": "400001",
      "country": "INDIA"
    },
    "parcel": {
      "description": "Books",
      "quantity": 1,
      "weight_kg": 0.5,
      "pieces": 1
    },
    "payment": {
      "mode": "PREPAID",
      "collectable_value": 0,
      "declared_value": 100
    }
  }' | jq
```

## Track

```bash
curl -s http://localhost:3000/api/v1/orders/ORD-DEMO-001/track \
  -H 'X-API-Key: dev-key-local' | jq
```

## Cancel

```bash
curl -s -X POST http://localhost:3000/api/v1/orders/ORD-DEMO-001/cancel \
  -H 'X-API-Key: dev-key-local' | jq
```

## Bulk

```bash
curl -s -X POST http://localhost:3000/api/v1/orders/bulk \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: dev-key-local' \
  -d '{
    "orders": [
      {
        "order_id": "ORD-BULK-1",
        "courier_partner": "mock",
        "shipper": {"name":"S","phone":"9876543210","address_line1":"A","city":"Delhi","state":"DL","pincode":"110001","country":"INDIA"},
        "consignee": {"name":"C1","phone":"9123456780","address_line1":"B","city":"Mumbai","state":"MH","pincode":"400001","country":"INDIA"},
        "parcel": {"description":"Item","quantity":1,"weight_kg":0.5,"pieces":1},
        "payment": {"mode":"PREPAID","collectable_value":0,"declared_value":50}
      },
      {
        "order_id": "ORD-BULK-2",
        "courier_partner": "mock",
        "shipper": {"name":"S","phone":"9876543210","address_line1":"A","city":"Delhi","state":"DL","pincode":"110001","country":"INDIA"},
        "consignee": {"name":"C2","phone":"9123456781","address_line1":"B","city":"Pune","state":"MH","pincode":"411001","country":"INDIA"},
        "parcel": {"description":"Item","quantity":1,"weight_kg":0.4,"pieces":1},
        "payment": {"mode":"COD","collectable_value":100,"declared_value":100}
      }
    ]
  }' | jq
```

## Batch status

```bash
BATCH_ID=<paste-batch-id>
curl -s "http://localhost:3000/api/v1/batches/$BATCH_ID" \
  -H 'X-API-Key: dev-key-local' | jq
```
