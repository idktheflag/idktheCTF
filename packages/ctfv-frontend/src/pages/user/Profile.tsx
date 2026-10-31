import { useAuth } from "@/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getBackendURL } from "@/lib/utils";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface UserProfile {
  id: string;
  username: string;
  email: string;
  rollNo?: string;
  instituteName?: string;
  website?: string;
  affiliation?: string;
  country?: string;
}

export const Profile: React.FC = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [rollNo, setRollNo] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [website, setWebsite] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [country, setCountry] = useState("");

  useEffect(() => {
    const fetchProfile = async () => {
      if (user && !user.isAdmin) {
        try {
          const response = await fetch(
            getBackendURL() + `/api/users/${user.userId}`,
            {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
            },
          );
          if (response.ok) {
            const data = await response.json();
            setProfile(data);
            setRollNo(data.rollNo || "");
            setInstituteName(data.instituteName || "");
            setWebsite(data.website || "");
            setAffiliation(data.affiliation || "");
            setCountry(data.country || "");
            console.log(data);
          } else {
            console.error("Failed to fetch profile");
          }
        } catch (error) {
          console.error("Error fetching profile:", error);
        }
      }
    };

    fetchProfile();
  }, [user]);

  if (user?.isAdmin || !user?.username) {
    return <Card className="mx-auto mt-8 w-full max-w-md"><CardHeader><CardTitle>{user?.isAdmin ? "Organizer account" : "Email verification required"}</CardTitle></CardHeader><CardContent className="space-y-4"><div className="space-y-1"><p className="text-sm text-muted-foreground">Email</p><p className="break-all font-medium">{user?.email}</p></div><p className="text-sm text-muted-foreground">Organizer accounts use email and password sign-in and do not have participant usernames.</p><Link className="text-sm text-primary hover:underline" to={user?.isAdmin ? "/admin/dashboard" : "/send-email"}>{user?.isAdmin ? "Open organizer dashboard →" : "Verify your email →"}</Link></CardContent></Card>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user) {
      try {
        const response = await fetch(
          getBackendURL() + `/api/users/${user.userId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({
              rollNo,
              instituteName,
              website,
              affiliation,
              country,
            }),
          },
        );
        if (response.ok) {
          const updatedProfile = await response.json();
          setProfile(updatedProfile);
          alert("Profile updated successfully!");
        } else {
          console.error("Failed to update profile");
        }
      } catch (error) {
        console.error("Error updating profile:", error);
      }
    }
  };

  if (!profile) {
    return <div>Loading...</div>;
  }

  return (
    <Card className="mx-auto mt-8 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-foreground text-foreground">
          Profile
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground text-muted-foreground">
              Username
            </label>
            <Input value={profile.username} disabled />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground text-muted-foreground">
              Email
            </label>
            <Input value={profile.email} disabled />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="rollNo"
              className="text-sm font-medium text-muted-foreground text-muted-foreground"
            >
              Roll No (optional)
            </label>
            <Input
              id="rollNo"
              value={rollNo}
              onChange={(e) => setRollNo(e.target.value)}
              placeholder="Enter your roll number"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="instituteName"
              className="text-sm font-medium text-muted-foreground text-muted-foreground"
            >
              Institute Name (optional)
            </label>
            <Input
              id="instituteName"
              value={instituteName}
              onChange={(e) => setInstituteName(e.target.value)}
              placeholder="Enter your institute name"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="websiteName"
              className="text-sm font-medium text-muted-foreground text-muted-foreground"
            >
              Website (optional)
            </label>
            <Input
              id="websiteName"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="Enter your website"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="affiliationName"
              className="text-sm font-medium text-muted-foreground text-muted-foreground"
            >
              Affiliation (optional)
            </label>
            <Input
              id="affiliationName"
              value={affiliation}
              onChange={(e) => setAffiliation(e.target.value)}
              placeholder="Enter your affiliation"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="countryName"
              className="text-sm font-medium text-muted-foreground text-muted-foreground"
            >
              Country (optional)
            </label>
            <Input
              id="countryName"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Enter your country"
            />
          </div>
          <Button type="submit" className="w-full">
            Update Profile
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

