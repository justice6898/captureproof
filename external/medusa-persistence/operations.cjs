// Narrow durable send barrier; actual PostgreSQL commits, not a repository mock.
module.exports = (PgClient, clientUrl) => {
  async function query(sql,args=[]) {
    const db=new PgClient({connectionString:clientUrl});await db.connect();
    try{return await db.query(sql,args);}finally{await db.end();}
  }
  const read=async(id,binding)=>{
    const row=(await query('SELECT * FROM captureproof_operation WHERE id=$1',[id])).rows[0];
    if(row&&JSON.stringify(row.binding)!==JSON.stringify(JSON.parse(JSON.stringify(binding)))) {
      // JSONB key order is not significant.
      if(Object.keys(binding).some(k=>row.binding[k]!==binding[k])||Object.keys(row.binding).length!==Object.keys(binding).length)throw new Error('OPERATION_BINDING_MISMATCH');
    }
    return row;
  };
  return {
    setup:()=>query(`CREATE TABLE IF NOT EXISTS captureproof_operation(id text PRIMARY KEY,binding jsonb NOT NULL,state text NOT NULL,capture_id text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`),
    read,
    reserve:async(id,binding)=>(await query("INSERT INTO captureproof_operation(id,binding,state) VALUES($1,$2,'submitted') ON CONFLICT DO NOTHING RETURNING id",[id,binding])).rowCount===1,
    update:(id,{state,captureId=null})=>query('UPDATE captureproof_operation SET state=$2,capture_id=COALESCE($3,capture_id),updated_at=now() WHERE id=$1',[id,state,captureId]),
    observe:async(id,binding,captureId,status)=>{
      const row=await read(id,binding);if(row?.capture_id&&row.capture_id!==captureId)throw new Error('OPERATION_CAPTURE_CONFLICT');
      return query('INSERT INTO captureproof_operation(id,binding,state,capture_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET state=$3,capture_id=$4,updated_at=now()',[id,binding,status,captureId]);
    }
  };
};
