import { activateDue } from "./launch-campaigns.service";

let started=false;
export function startLaunchCampaignWorker(){if(started)return;started=true;const run=()=>{void activateDue().catch((error)=>console.error("Launch campaign worker failed",error));};run();setInterval(run,60_000).unref();}
