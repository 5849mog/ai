// Render the actual position locally; opening proposals remain outlined labels,
// never solid stones. This deliberately omits engine evaluations and hints.
export function drawBoardImage(ctx, { board, lastMove = -1, candidates = [] }) {
  if (!board || board.length !== 225 || Array.from(board).some(c => ![0,1,2].includes(c))) throw new Error('棋盘无效');
  const size=900, margin=72, step=(size-2*margin)/14;
  const wood=ctx.createLinearGradient(0,0,size,size);wood.addColorStop(0,'#f2dfb8');wood.addColorStop(1,'#d1af78');ctx.fillStyle=wood;ctx.fillRect(0,0,size,size);
  ctx.strokeStyle='#6d573c';ctx.lineWidth=2;
  for(let i=0;i<15;i++){const p=margin+i*step;ctx.beginPath();ctx.moveTo(margin,p);ctx.lineTo(size-margin,p);ctx.moveTo(p,margin);ctx.lineTo(p,size-margin);ctx.stroke();}
  ctx.fillStyle='#5d4a34';for(const row of [3,7,11])for(const col of [3,7,11]){ctx.beginPath();ctx.arc(margin+col*step,margin+row*step,4,0,Math.PI*2);ctx.fill();}
  for(let i=0;i<225;i++)if(board[i]){
    const x=margin+(i%15)*step,y=margin+Math.floor(i/15)*step,r=step*.4;
    const stone=ctx.createRadialGradient(x-r*.3,y-r*.35,r*.05,x,y,r);
    if(board[i]===1){stone.addColorStop(0,'#676963');stone.addColorStop(1,'#111512');}else{stone.addColorStop(0,'#ffffff');stone.addColorStop(1,'#d3d0c3');}
    ctx.fillStyle=stone;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle=board[i]===1?'#171a16':'#a7a195';ctx.lineWidth=1.5;ctx.stroke();
    if(i===lastMove){ctx.strokeStyle=board[i]===1?'#f2eee3':'#b64b36';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,r*.35,0,Math.PI*2);ctx.stroke();}
  }
  ctx.font=`600 ${Math.round(step*.3)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  for(const [rank,index] of candidates.entries())if(Number.isInteger(index)&&index>=0&&index<225&&!board[index]){
    const x=margin+(index%15)*step,y=margin+Math.floor(index/15)*step;ctx.fillStyle='#faf5e7';ctx.strokeStyle='#597452';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,step*.36,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#365c37';ctx.fillText(`A${rank+1}`,x,y);
  }
}
export function boardImageBlob(position, doc = document) {
  const canvas=doc.createElement('canvas');canvas.width=canvas.height=900;const ctx=canvas.getContext('2d');if(!ctx||!canvas.toBlob)throw new Error('当前浏览器不支持保存图片');
  drawBoardImage(ctx,position);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('图片生成失败')),'image/png'));
}
