process.env.OPENAI_API_KEY='synthetic-openai-key';process.env.ANTHROPIC_API_KEY='synthetic-anthropic-key';
export const TURN={reply:'Thanks. What is your primary goal?',updates:[{field:'organization',value:'Harbor',evidence:'Harbor'}],openQuestions:['What is your primary goal?']};
export function bodyFor(provider,turn=TURN) {
  return provider==='openai'?{id:'resp_synthetic',created_at:1792110000,model:'gpt-synthetic',status:'completed',output:[{id:'msg_synthetic',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(turn),annotations:[]}]}],incomplete_details:null,usage:{input_tokens:10,output_tokens:5,total_tokens:15},unknown_field:{retained:true}}:{id:'msg_synthetic',type:'message',role:'assistant',model:'claude-synthetic',content:[{type:'text',text:JSON.stringify(turn)}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:5},unknown_field:{retained:true}};
}
