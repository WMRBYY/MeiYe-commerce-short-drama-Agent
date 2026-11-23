# Schema 107 升级夹具

`production107.sql.gz` 是使用合并父提交 `ef5e904` 对应的生产源码、旧版模型和迁移程序生成的 SQLite SQL 转储，包含完整旧表结构和迁移账本。50–53 使用本站生产迁移身份。转储只含模拟用户、积分余额、直接扣款订单、流水、运行中任务与电商草稿，没有生产数据。

`TestV187UpgradePreservesProduction107DataAndLedger` 将其载入临时数据库，重复执行升级，检查旧账本不变、个人账户身份回填、余额与订单保留、任务不重发、草稿不变以及上游新表存在。该 SQLite 回归不能替代生产 PostgreSQL 副本演练。
