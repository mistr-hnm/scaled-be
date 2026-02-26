
Tier 1 :

[ Client ] 
      │
      ▼
  ┌───────┐      Simple Express App
  │ Node  │──┐   Single Instance
  └───────┘  │   Direct DB Connection
      │      │   
      ▼      │
  ┌───────┐  │   Postgres (The Source)
  │  DB   │◀─┘
  └───────┘  
------------------------------------------------------

  Tier 2 :

  [ Client ]
      │
      ▼
  ┌───────────┐  Cluster Master
  │  Node (M) │  (Spawns Workers)
  └─────┬─────┘
        │ ┌───────────────┐
        ├─┤ Worker 1 (CPU)│──┐
        ├─┤ Worker 2 (CPU)│──┤  Shared DB Pool
        └─┤ Worker 3 (CPU)│──┘  (Max: 20-50)
                │
                ▼
          ┌───────────┐
          │ Postgres  │
          └───────────┘

------------------------------------------------------
Tier 3 : 

[ Load Balancer (Nginx) ]
             │
      ┌──────┴──────┐
   [App]          [App]      ◄── Multi-Server
      │              │
      ▼              ▼
  [ Redis ]   [ PgBouncer ]  ◄── Connection Proxy
      ▲              │
      │       ┌──────┴──────┐
      │       ▼             ▼
      └─ [Primary]      [Replica]  ◄── Read/Write Split
           (Write)       (Read)
------------------------------------------------------

Tier 4 : 

[ Global Anycast IP / Cloudflare ]
                  │
      [ Cloud Load Balancer (ALB/NLB) ] ◀── Layer 7 Routing
                  │
        ┌─────────┴─────────┐
   [ App Node ] [ App Node ] [ App Node ] ◀── Auto-Scaling Group (50+ Nodes)
        │           │           │             (Managed K8s / EKS)
        ▼           ▼           ▼
   [    Redis Cluster (Sharded)     ] ◀── Cache Sharding (10+ Nodes)
        │           │           │
        ▼           ▼           ▼
   [ Message Queue (RabbitMQ/Kafka) ] ◀── Write Buffer (Async Processing)
        │           │           │
   ┌────┴───────────┼───────────┴───┐
   ▼                ▼               ▼
[Shard 0]        [Shard 1]       [Shard 2] ◀── Database Sharding
 (P + R)          (P + R)          (P + R)      (Independent Clusters)
------------------------------------------------------