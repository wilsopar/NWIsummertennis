export const seed = {
  archiveDays: 30,
  home: {
    headerTitle: "Summer Tennis",
    favicon: "",
    title: "Make this a tennis summer.",
    intro: "NWI Summer Tennis helps Northwest Indiana players improve their game, build confidence, and have more fun on court.",
    storyTitle: "Meet the founder",
    story: "Add your story here: how NWI Summer Tennis started, what inspired you to coach, and what you hope every player takes home.",
    contact: "Add your email or phone number",
    logo: "", heroMode: "photo", hero: "", founder: "", instagram: "", facebook: "",
    policy: "All bookings are final. Rainouts will be rescheduled. For emergencies, contact us directly about a possible refund or reschedule."
  },
  coaches: [
    {id:"coach-1",name:"Sample Coach",price:3500,photo:"",awards:"Add coaching distinctions and awards.",story:"Add your tennis background here.",players:"Example: ages 8–16, beginner to intermediate."}
  ],
  offerings: [
    ...["Junior Girls","Junior Boys","Elite Girls","Elite Boys"].map((title,i)=>({id:"camp-"+i,type:"camp",title,description:i<2?"Sample group for ages 6–11.":"Sample group for players entering grades 5–10.",date:"2027-06-14",endDate:"2027-06-17",time:i<2?"09:00":"11:00",duration:90,location:"Valparaiso High School Tennis Courts",coach:"coach-1",price:8500,photo:""})),
    {id:"event-1",type:"event",title:"Summer Match Play",description:"Add event format, eligibility and what to bring.",date:"2027-06-26",time:"10:00",duration:120,location:"Court location placeholder",coach:"coach-1",price:2000,photo:""},
    ...["2027-06-14","2027-06-21","2027-06-28"].flatMap((date,i)=>["14:00","15:00"].map((time,j)=>({id:"slot-"+i+"-"+j,type:"lesson",date,time,duration:60,location:"Shorewood Tennis Courts",coach:"coach-1"})))
  ]
};
