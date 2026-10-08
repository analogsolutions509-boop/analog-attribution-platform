import PDFDocument from "pdfkit";

export function generateReportPdf(report:any,start:string,end:string){
  const doc=new PDFDocument({size:"A4",margin:48});
  const chunks:Buffer[]=[];
  doc.on("data",(chunk:Buffer)=>chunks.push(chunk));
  doc.fillColor("#111827").fontSize(20).text("ANALOG SOLUTIONS");
  doc.fontSize(12).text("Analog Attribution Performance Report");
  doc.fontSize(10).text("Period: "+start+" to "+end);
  const cards=[["Leads",report.kpi.leads],["Contacted",report.kpi.touched],["Sales",report.kpi.sales]];
  let y=145;
  for(const card of cards){
    doc.fontSize(10).text(card[0],48,y);
    doc.fontSize(18).text(String(card[1]),48,y+14);
    y+=52;
  }
  doc.fontSize(12).text("Daily lead volume",48,330);
  const points=report.daily.slice(-14);
  const max=Math.max(1,...points.map((row:any)=>Number(row.leads)||0));
  let x=48;
  const baseY=490;
  for(const row of points){
    const height=((Number(row.leads)||0)/max)*110;
    doc.fillColor("#55d6ff").rect(x,baseY-height,18,height).fill();
    doc.fillColor("#111827").fontSize(7).text(String(row.day).slice(5),x-2,baseY+5,{width:30});
    x+=27;
  }
  doc.addPage().fillColor("#111827").fontSize(14).text("Supplier outcomes",48,48);
  y=85;
  for(const row of report.suppliers){
    doc.fontSize(10).text(row.supplier+": "+row.leads+" leads / "+row.sales+" sales",48,y);
    y+=18;
  }
  doc.end();
  return new Promise<Buffer>(resolve=>doc.on("end",()=>resolve(Buffer.concat(chunks))));
}